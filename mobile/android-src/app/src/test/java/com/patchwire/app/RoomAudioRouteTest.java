package com.patchwire.app;

import android.Manifest;
import android.app.Application;
import android.bluetooth.BluetoothHeadset;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothClass;
import android.bluetooth.BluetoothProfile;
import android.content.Context;
import android.content.Intent;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Looper;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.Implementation;
import org.robolectric.annotation.Implements;
import org.robolectric.annotation.LooperMode;
import org.robolectric.shadow.api.Shadow;
import org.robolectric.shadows.AudioDeviceInfoBuilder;
import org.robolectric.shadows.ShadowAudioManager;
import org.robolectric.shadows.ShadowBluetoothHeadset;
import org.robolectric.util.ReflectionHelpers;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34, manifest = Config.NONE, shadows = RoomAudioRouteTest.Android12Audio.class)
@LooperMode(LooperMode.Mode.PAUSED)
public class RoomAudioRouteTest {
    private Application context;
    private AudioManager audio;
    private ShadowAudioManager shadow;
    private RoomAudioRoute routes;
    private final List<String> events = new ArrayList<>();
    private final List<String> failures = new ArrayList<>();
    private AudioDeviceInfo speaker, bluetooth, wired;
    private BluetoothHeadset headsetProxy;
    private BluetoothDevice headsetDevice;
    private ShadowBluetoothHeadset headsets;
    @Before public void setup() {
        context = RuntimeEnvironment.getApplication(); Shadows.shadowOf(context).grantPermissions(Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH);
        context.getSharedPreferences("whassabi_audio", Context.MODE_PRIVATE).edit().clear().commit();
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter(); Shadows.shadowOf(adapter).setEnabled(true);
        headsetProxy = Shadow.newInstanceOf(BluetoothHeadset.class); headsets = Shadows.shadowOf(headsetProxy);
        headsetDevice = adapter.getRemoteDevice("10:20:30:40:50:60"); headsets.addConnectedDevice(headsetDevice);
        Shadows.shadowOf(headsetDevice).setBluetoothClass(ReflectionHelpers.callConstructor(BluetoothClass.class, ReflectionHelpers.ClassParameter.from(int.class, BluetoothClass.Device.AUDIO_VIDEO_WEARABLE_HEADSET)));
        Shadows.shadowOf(adapter).setProfileProxy(BluetoothProfile.HEADSET, headsetProxy);
        assertTrue(adapter.isEnabled()); assertEquals(1, headsetProxy.getConnectedDevices().size());
        assertEquals(BluetoothClass.Device.Major.AUDIO_VIDEO, headsetDevice.getBluetoothClass().getMajorDeviceClass());
        audio = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE); shadow = Shadows.shadowOf(audio);
        speaker = device(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER); bluetooth = device(AudioDeviceInfo.TYPE_BLUETOOTH_SCO); wired = device(AudioDeviceInfo.TYPE_WIRED_HEADSET);
        audio.setMode(AudioManager.MODE_NORMAL); audio.setSpeakerphoneOn(false); audio.setBluetoothScoOn(false);
        routes = new RoomAudioRoute(context, audio, (ready, route, generation, failed, failedRoute) -> {
            events.add(ready + ":" + route + ":" + generation + ":" + failed); if (failed) failures.add(failedRoute);
        });
    }
    @After public void teardown() { routes.stop(); }
    private AudioDeviceInfo device(int type) { return AudioDeviceInfoBuilder.newBuilder().setType(type).build(); }
    private void idle(long ms) { Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(ms)); }
    private String ready() { final String[] result = {null}; routes.awaitReady((managed, route, generation) -> result[0] = managed + ":" + route); return result[0]; }
    private void available(AudioDeviceInfo... devices) { shadow.setAvailableCommunicationDevices(Arrays.asList(devices)); }

    @Test public void connectingAndRemovingEarbudsSwitchesBothEndsOfTheCommunicationRouteWithoutRestart() {
        available(speaker); routes.start(); assertEquals("true:speaker", ready());
        assertEquals(AudioManager.MODE_IN_COMMUNICATION, audio.getMode());
        shadow.addAvailableCommunicationDevice(bluetooth, true); idle(300);
        assertEquals(AudioDeviceInfo.TYPE_BLUETOOTH_SCO, audio.getCommunicationDevice().getType()); assertEquals("true:bluetooth", ready());
        assertFalse(audio.isBluetoothScoOn()); // API 31+ uses the communication-device API, not legacy SCO flags.
        shadow.removeAvailableCommunicationDevice(bluetooth, true); idle(300);
        assertEquals(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER, audio.getCommunicationDevice().getType()); assertEquals("true:speaker", ready());
    }
    @Test public void alreadyConnectedEarbudsAndBleHeadsetsAreSelectedBeforeMicrophoneCapture() {
        available(speaker, bluetooth); routes.start(); assertEquals("true:bluetooth", ready());
        shadow.removeAvailableCommunicationDevice(bluetooth, true);
        AudioDeviceInfo ble = device(AudioDeviceInfo.TYPE_BLE_HEADSET); shadow.addAvailableCommunicationDevice(ble, true); idle(300);
        assertEquals(AudioDeviceInfo.TYPE_BLE_HEADSET, audio.getCommunicationDevice().getType()); assertEquals("true:bluetooth", ready());
    }
    @Test public void wiredAndUsbHeadsetsTakePriorityAndUnpluggingReturnsToTheAvailableBluetoothHeadset() {
        available(speaker, bluetooth, wired); routes.start(); assertEquals("true:wired", ready());
        shadow.removeAvailableCommunicationDevice(wired, true); idle(300); assertEquals("true:bluetooth", ready());
        AudioDeviceInfo usb = device(AudioDeviceInfo.TYPE_USB_HEADSET); shadow.addAvailableCommunicationDevice(usb, true); idle(300);
        assertEquals(AudioDeviceInfo.TYPE_USB_HEADSET, audio.getCommunicationDevice().getType()); assertEquals("true:wired", ready());
    }
    @Test public void nearbyDevicesDenialLeavesPhoneAudioUsableAndGrantingInSettingsDoesNotRequireRestart() {
        Shadows.shadowOf(context).denyPermissions(Manifest.permission.BLUETOOTH_CONNECT); available(speaker, bluetooth);
        routes.start(); assertEquals("true:speaker", ready());
        Shadows.shadowOf(context).grantPermissions(Manifest.permission.BLUETOOTH_CONNECT); routes.resume(); idle(300);
        assertEquals("true:bluetooth", ready());
    }
    @Test public void stableDeviceUpdatesDoNotRequestRepeatedMicrophoneRestartsAndStopReleasesRouting() {
        available(speaker, bluetooth); routes.start(); int count = events.size();
        routes.refreshNow(); routes.resume(); idle(300); assertEquals("true:bluetooth", ready()); assertEquals(count, events.size());
        routes.stop(); assertNull(audio.getCommunicationDevice()); assertEquals(AudioManager.MODE_NORMAL, audio.getMode());
        shadow.addAvailableCommunicationDevice(wired, true); idle(1000); assertEquals(count, events.size()); assertEquals("false:system", ready());
    }
    @Test public void webViewRestoringItsDefaultCannotMoveAnActiveHeadsetBackToThePhoneOrCreateACaptureLoop() {
        available(speaker, bluetooth); routes.start();
        long changes = events.stream().filter(event -> event.startsWith("false:")).count();
        audio.setCommunicationDevice(speaker); routes.refreshNow(); assertEquals("true:bluetooth", ready());
        assertEquals(AudioDeviceInfo.TYPE_BLUETOOTH_SCO, audio.getCommunicationDevice().getType());
        assertEquals(changes, events.stream().filter(event -> event.startsWith("false:")).count());
    }
    @Test @Config(shadows = DelayedAudio.class) public void captureWaitsForActualConfirmationAndLeaveResolvesPendingWaiters() {
        available(speaker, bluetooth); routes.start(); assertNull(ready());
        DelayedAudio delayed = Shadow.extract(audio); delayed.confirm(); idle(300); assertEquals("true:bluetooth", ready());
        delayed.delay = true; shadow.addAvailableCommunicationDevice(wired, true); idle(300); assertNull(ready());
        final boolean[] completed = {false}; routes.awaitReady((managed, route, generation) -> { completed[0] = true; assertFalse(managed); });
        routes.stop(); assertTrue(completed[0]); idle(35000); assertEquals(AudioManager.MODE_NORMAL, audio.getMode());
    }
    @Test @Config(shadows = DelayedAudio.class) public void failedBluetoothHasABoundedWaitAndCannotHoldCaptureForever() {
        available(speaker, bluetooth); routes.start(); assertNull(ready()); idle(33500);
        assertNotNull(ready()); assertTrue(events.stream().anyMatch(event -> event.endsWith(":true")));
    }
    @Test @Config(sdk = 28) public void legacyScoMustConnectBeforeCaptureAndUnplugRestoresThePhoneSpeaker() {
        shadow.setOutputDevices(Arrays.asList(bluetooth)); shadow.setIsBluetoothScoAvailableOffCall(true); routes.start(); assertNull(ready());
        context.sendBroadcast(new Intent(AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED).putExtra(AudioManager.EXTRA_SCO_AUDIO_STATE, AudioManager.SCO_AUDIO_STATE_CONNECTED)); idle(1);
        assertEquals("true:bluetooth", ready()); assertTrue(audio.isBluetoothScoOn());
        shadow.setOutputDevices(new ArrayList<>());
        context.sendBroadcast(new Intent(BluetoothHeadset.ACTION_CONNECTION_STATE_CHANGED).putExtra(BluetoothProfile.EXTRA_STATE, BluetoothProfile.STATE_DISCONNECTED)); idle(500);
        assertEquals("true:speaker", ready()); assertTrue(audio.isSpeakerphoneOn()); assertFalse(audio.isBluetoothScoOn());
    }
    @Test @Config(sdk = 28) public void legacyScoTimeoutFallsBackAndDoesNotKeepRestartingTheSameFailedHeadset() {
        shadow.setOutputDevices(Arrays.asList(bluetooth)); shadow.setIsBluetoothScoAvailableOffCall(true); routes.start(); assertNull(ready()); idle(31000);
        assertEquals("true:speaker", ready()); assertTrue(audio.isSpeakerphoneOn()); assertTrue(events.stream().anyMatch(event -> event.endsWith(":true")));
        int count = events.size(); routes.refreshNow(); idle(1000); assertEquals(count, events.size());
    }
    @Test @Config(sdk = 28) public void legacyCleanupRestoresSpeakerStateAndReleasesCommunicationMode() {
        routes.start(); idle(300); assertTrue(audio.isSpeakerphoneOn()); routes.stop();
        assertFalse(audio.isSpeakerphoneOn()); assertEquals(AudioManager.MODE_NORMAL, audio.getMode());
    }
    @Test @Config(sdk = 31, shadows = ModernOnlyAudio.class) public void android12UsesOnlyTheCommunicationDeviceApiWithoutWaitingForLegacyScoBroadcasts() {
        available(speaker, bluetooth); routes.start(); idle(300);
        assertEquals("true:bluetooth", ready());
        assertFalse(audio.isBluetoothScoOn());
        context.sendBroadcast(new Intent(AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED).putExtra(AudioManager.EXTRA_SCO_AUDIO_STATE, AudioManager.SCO_AUDIO_STATE_DISCONNECTED)); idle(300);
        assertEquals("true:bluetooth", ready());
        shadow.removeAvailableCommunicationDevice(bluetooth, true); idle(300); assertEquals("true:speaker", ready());
        routes.stop(); assertEquals(AudioManager.MODE_NORMAL, audio.getMode());
    }
    @Test @Config(sdk = 31, shadows = DelayedAudio.class) public void captureCanStartBeforeAndroidFinishesTheBluetoothRoute() {
        available(speaker, bluetooth); routes.start(); idle(300); assertNull(ready());
        final String[] capture = {null}; final long[] generation = {-1};
        routes.captureRoute((managed, route, serial) -> { capture[0] = managed + ":" + route; generation[0] = serial; });
        assertEquals("true:system", capture[0]); assertEquals(0, generation[0]);
        // An OEM can defer this confirmation until the app has started AudioRecord.
        DelayedAudio delayed = Shadow.extract(audio); delayed.confirm(); idle(300);
        routes.captureRoute((managed, route, serial) -> { capture[0] = managed + ":" + route; generation[0] = serial; });
        assertEquals("true:bluetooth", capture[0]); assertTrue(generation[0] > 0);
        routes.stop(); routes.captureRoute((managed, route, serial) -> assertFalse(managed));
    }
    /** Android 12's two public speaker APIs address the same route; model that platform alias. */
    @Implements(AudioManager.class) public static class Android12Audio extends ShadowAudioManager {
        int compatibilityCalls;
        @Implementation protected void setSpeakerphoneOn(boolean on) {
            super.setSpeakerphoneOn(on);
            if (android.os.Build.VERSION.SDK_INT < 31 || android.os.Build.VERSION.SDK_INT > 32) return;
            if (on) {
                compatibilityCalls++;
                for (AudioDeviceInfo device : getAvailableCommunicationDevices()) if (device.getType() == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) { super.setCommunicationDevice(device); break; }
            } else { AudioDeviceInfo current = getCommunicationDevice(); if (current != null && current.getType() == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) super.clearCommunicationDevice(); }
        }
        @Implementation protected boolean setCommunicationDevice(AudioDeviceInfo device) {
            boolean result = super.setCommunicationDevice(device);
            if (result && android.os.Build.VERSION.SDK_INT >= 31 && android.os.Build.VERSION.SDK_INT <= 32) super.setSpeakerphoneOn(device.getType() == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER);
            return result;
        }
        @Implementation protected void clearCommunicationDevice() { super.clearCommunicationDevice(); if (android.os.Build.VERSION.SDK_INT >= 31 && android.os.Build.VERSION.SDK_INT <= 32) super.setSpeakerphoneOn(false); }
    }
    @Implements(AudioManager.class) public static class ModernOnlyAudio extends Android12Audio {
        @Implementation protected void startBluetoothSco() { throw new AssertionError("Do not mix legacy SCO with setCommunicationDevice on Android 12+"); }
    }
    @Test @Config(sdk = 31) public void disconnectingTheHeadsetReturnsToLoudspeakerEvenWhileTheDeviceListIsStale() {
        AudioDeviceInfo earpiece = device(AudioDeviceInfo.TYPE_BUILTIN_EARPIECE);
        available(earpiece, speaker, bluetooth); routes.start(); idle(300); assertEquals("true:bluetooth", ready());
        headsets.removeDevice(headsetDevice);
        context.sendBroadcast(new Intent(BluetoothHeadset.ACTION_CONNECTION_STATE_CHANGED).putExtra(BluetoothProfile.EXTRA_STATE, BluetoothProfile.STATE_DISCONNECTED)); idle(300);
        assertEquals("true:speaker", ready()); assertEquals(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER, audio.getCommunicationDevice().getType());
        routes.refreshNow(); idle(500); assertEquals("true:speaker", ready());
        headsets.addConnectedDevice(headsetDevice);
        context.sendBroadcast(new Intent(BluetoothHeadset.ACTION_CONNECTION_STATE_CHANGED).putExtra(BluetoothProfile.EXTRA_STATE, BluetoothProfile.STATE_CONNECTED)); idle(300);
        assertEquals("true:bluetooth", ready());
    }
    @Test @Config(sdk = 31) public void webViewResettingCommunicationModeCannotLeavePlaybackOnTheCallEarpiece() {
        AudioDeviceInfo earpiece = device(AudioDeviceInfo.TYPE_BUILTIN_EARPIECE);
        available(speaker, earpiece); routes.start(); assertEquals("true:speaker", ready());
        audio.setMode(AudioManager.MODE_NORMAL); audio.setCommunicationDevice(earpiece); idle(600);
        assertEquals(AudioManager.MODE_IN_COMMUNICATION, audio.getMode());
        assertEquals(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER, audio.getCommunicationDevice().getType());
    }
    @Test @Config(sdk = 31) public void modeRecoveryDoesNotTakeOverAnActiveTelephoneCall() {
        available(speaker); routes.start(); audio.setMode(AudioManager.MODE_IN_CALL); idle(600);
        assertEquals(AudioManager.MODE_IN_CALL, audio.getMode());
        audio.setMode(AudioManager.MODE_NORMAL); idle(600);
        assertEquals(AudioManager.MODE_IN_COMMUNICATION, audio.getMode()); assertEquals("true:speaker", ready());
    }
    @Implements(AudioManager.class) public static class DelayedAudio extends Android12Audio {
        boolean delay = true;
        private AudioDeviceInfo requested;
        @Implementation protected boolean setCommunicationDevice(AudioDeviceInfo device) { requested = device; return delay || super.setCommunicationDevice(device); }
        void confirm() { delay = false; super.setCommunicationDevice(requested); }
    }
    @Test @Config(sdk = 34, shadows = StaleSpeakerAudio.class) public void initialSpeakerRequestOverriddenByWebViewIsClearedAndReappliedWithoutWaitingForTimeout() {
        available(speaker, device(AudioDeviceInfo.TYPE_BUILTIN_EARPIECE)); routes.start(); assertNull(ready());
        assertEquals(AudioDeviceInfo.TYPE_BUILTIN_EARPIECE, audio.getCommunicationDevice().getType());
        idle(249); assertNull(ready()); idle(1);
        assertEquals("true:speaker", ready()); assertEquals(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER, audio.getCommunicationDevice().getType());
        StaleSpeakerAudio state = Shadow.extract(audio); assertEquals(2, state.speakerRequests); assertEquals(1, state.clears);
        assertTrue(failures.isEmpty()); assertEquals(1, events.stream().filter(e -> e.startsWith("false:")).count());
        routes.refreshNow(); idle(1000); assertEquals(2, state.speakerRequests);
    }
    @Test @Config(sdk = 34, shadows = StaleSpeakerAudio.class) public void leavingDuringInitialSpeakerRecoveryCancelsRetries() {
        available(speaker, device(AudioDeviceInfo.TYPE_BUILTIN_EARPIECE)); routes.start(); assertNull(ready());
        StaleSpeakerAudio state = Shadow.extract(audio); routes.stop(); idle(35000);
        assertEquals(1, state.speakerRequests); assertEquals(AudioManager.MODE_NORMAL, audio.getMode()); assertNull(audio.getCommunicationDevice());
    }
    @Test @Config(sdk = 34, shadows = DelayedAudio.class) public void unusablePhoneRouteHasBoundedRetriesAndNeverReportsAHeadsetFailure() {
        available(speaker); routes.start(); assertNull(ready());
        idle(4500); assertEquals("true:system", ready()); assertEquals(Arrays.asList("speaker"), failures);
        int count = events.size(); routes.refreshNow(); idle(35000); assertEquals(count, events.size());
    }
    @Test @Config(sdk = 31, shadows = UnavailableBluetoothAudio.class) public void unavailableBluetoothFallsBackPromptlyAndReportsTheActualFailedRoute() {
        available(speaker, bluetooth); routes.start(); idle(300); assertNull(ready()); idle(5500);
        assertEquals("true:speaker", ready()); assertEquals(Arrays.asList("bluetooth"), failures);
        int count = events.size(); routes.refreshNow(); idle(35000); assertEquals(count, events.size());
    }
    @Test @Config(sdk = 34, shadows = StaleSpeakerAudio.class) public void pendingSpeakerRetriesDoNotOverrideAnActiveTelephoneCall() {
        available(speaker, device(AudioDeviceInfo.TYPE_BUILTIN_EARPIECE)); routes.start();
        StaleSpeakerAudio state = Shadow.extract(audio); audio.setMode(AudioManager.MODE_IN_CALL); idle(1000);
        assertEquals(1, state.speakerRequests); assertEquals(AudioManager.MODE_IN_CALL, audio.getMode());
        audio.setMode(AudioManager.MODE_NORMAL); idle(1000); assertEquals("true:speaker", ready());
    }
    @Implements(AudioManager.class) public static class StaleSpeakerAudio extends Android12Audio {
        int speakerRequests, clears; boolean stale;
        @Implementation protected boolean setCommunicationDevice(AudioDeviceInfo device) {
            if (device.getType() == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) {
                if (++speakerRequests == 1) { stale = true; super.setCommunicationDevice(AudioDeviceInfoBuilder.newBuilder().setType(AudioDeviceInfo.TYPE_BUILTIN_EARPIECE).build()); }
                if (stale) return true; // Accepted preference, but startup still uses the call earpiece.
            }
            return super.setCommunicationDevice(device);
        }
        @Implementation protected void clearCommunicationDevice() { clears++; stale = false; super.clearCommunicationDevice(); }
    }
    @Implements(AudioManager.class) public static class UnavailableBluetoothAudio extends Android12Audio {
        java.util.concurrent.Executor executor; AudioManager.OnCommunicationDeviceChangedListener listener;
        @Implementation protected void addOnCommunicationDeviceChangedListener(java.util.concurrent.Executor executor, AudioManager.OnCommunicationDeviceChangedListener listener) {
            this.executor = executor; this.listener = listener;
        }
        @Implementation protected boolean setCommunicationDevice(AudioDeviceInfo device) { return RoomAudioRoute.isBluetooth(device.getType()) || super.setCommunicationDevice(device); }
        void staleBluetoothEvent(AudioDeviceInfo device) { super.setCommunicationDevice(device); executor.execute(() -> listener.onCommunicationDeviceChanged(device)); }
    }
    private long generation() { final long[] result = {-1}; routes.captureRoute((managed, route, serial) -> result[0] = serial); return result[0]; }
    private void classify(BluetoothDevice device, int type) { Shadows.shadowOf(device).setBluetoothClass(ReflectionHelpers.callConstructor(BluetoothClass.class, ReflectionHelpers.ClassParameter.from(int.class, type))); }
    private void address(AudioDeviceInfo device, String value, int id) {
        Object port = ReflectionHelpers.getField(device, "mPort"); ReflectionHelpers.setField(port, "mAddress", value);
        ReflectionHelpers.setField(ReflectionHelpers.getField(port, "mHandle"), "mId", id);
    }
    @Test @Config(sdk = 31) public void connectedWatchDoesNotBecomeAutomaticRoomAudio() {
        classify(headsetDevice, BluetoothClass.Device.WEARABLE_WRIST_WATCH);
        available(speaker, bluetooth); routes.start(); idle(300);
        assertEquals("true:speaker", ready()); long serial = generation(); idle(10000);
        assertEquals("true:speaker", ready()); assertEquals(serial, generation()); assertTrue(failures.isEmpty());
    }
    @Test @Config(sdk = 31) public void staleBluetoothPortWithoutAConnectedHfpDeviceCannotDelaySpeakerStartup() {
        headsets.removeDevice(headsetDevice); available(speaker, bluetooth); routes.start();
        assertEquals("true:speaker", ready()); idle(10000); assertEquals("true:speaker", ready()); assertTrue(failures.isEmpty());
    }
    @Test @Config(sdk = 31, shadows = UnavailableBluetoothAudio.class) public void staleBluetoothCallbacksAfterFailureCannotReenableTheFailedDeviceOrRestartCapture() {
        available(speaker, bluetooth); routes.start(); idle(6000); assertEquals("true:speaker", ready()); long serial = generation();
        UnavailableBluetoothAudio state = Shadow.extract(audio);
        for (int n = 0; n < 5; n++) { state.staleBluetoothEvent(bluetooth); idle(500); assertEquals("true:speaker", ready()); assertEquals(serial, generation()); }
        assertEquals(Arrays.asList("bluetooth"), failures);
    }
    @Test @Config(sdk = 31) public void explicitPhoneSpeakerStaysSelectedWithAWatchAndAcrossRoomRestarts() {
        available(speaker, bluetooth); routes.setOutputMode("speaker"); routes.start(); idle(300); assertEquals("true:speaker", ready());
        audio.setCommunicationDevice(bluetooth); routes.refreshNow(); assertEquals("true:speaker", ready());
        routes.stop(); Shadows.shadowOf(BluetoothAdapter.getDefaultAdapter()).setProfileProxy(BluetoothProfile.HEADSET, headsetProxy);
        routes = new RoomAudioRoute(context, audio, (a, b, c, d, e) -> {}); routes.start(); idle(300);
        assertEquals("true:speaker", ready()); assertEquals("speaker", RoomAudioRoute.outputMode(context)); assertTrue(failures.isEmpty());
    }
    @Test @Config(sdk = 31) public void earbudsTakePriorityOverTheWatchAndRemovingEarbudsReturnsToSpeaker() {
        BluetoothDevice watch = BluetoothAdapter.getDefaultAdapter().getRemoteDevice("AA:BB:CC:DD:EE:FF"); classify(watch, BluetoothClass.Device.WEARABLE_WRIST_WATCH); headsets.addConnectedDevice(watch);
        AudioDeviceInfo watchPort = device(AudioDeviceInfo.TYPE_BLUETOOTH_SCO); address(watchPort, watch.getAddress(), 71); address(bluetooth, headsetDevice.getAddress(), 72);
        available(speaker, watchPort, bluetooth); routes.start(); idle(300); assertEquals("true:bluetooth", ready()); assertEquals(72, audio.getCommunicationDevice().getId());
        headsets.removeDevice(headsetDevice); context.sendBroadcast(new Intent(BluetoothHeadset.ACTION_CONNECTION_STATE_CHANGED).putExtra(BluetoothProfile.EXTRA_STATE, BluetoothProfile.STATE_DISCONNECTED)); idle(600);
        assertEquals("true:speaker", ready()); assertTrue(failures.isEmpty());
    }
    @Test @Config(sdk = 34, shadows = DelayedAudio.class) public void unconfirmedSpeakerNeverClearsThePreferenceOrChangesMicrophoneGeneration() {
        available(speaker); routes.start(); String first = events.get(0).split(":")[2]; idle(4500);
        assertEquals("true:system", ready()); assertEquals(Long.parseLong(first), generation());
        DelayedAudio state = Shadow.extract(audio); state.confirm(); routes.refreshNow(); idle(300);
        assertEquals("true:speaker", ready()); assertEquals(Long.parseLong(first), generation());
    }
    @Test @Config(sdk = 31) public void aWatchCanBeSelectedOnlyByAnExplicitBluetoothChoice() {
        classify(headsetDevice, BluetoothClass.Device.WEARABLE_WRIST_WATCH); available(speaker, bluetooth); routes.start(); idle(300);
        assertEquals("true:speaker", ready()); routes.setOutputMode("bluetooth"); idle(300);
        assertEquals("true:bluetooth", ready()); routes.setOutputMode("speaker"); assertEquals("true:speaker", ready());
    }
    @Test @Config(sdk = 31, shadows = DelayedProfileAdapter.class) public void leavingClosesAProfileDeliveredAsynchronouslyAndCannotRestartRouting() throws Exception {
        available(speaker, bluetooth); routes.start(); assertEquals("true:speaker", ready());
        DelayedProfileAdapter state = Shadow.extract(BluetoothAdapter.getDefaultAdapter());
        Thread binder = new Thread(() -> state.pending.onServiceConnected(BluetoothProfile.HEADSET, headsetProxy)); binder.start(); binder.join();
        routes.stop(); idle(1000);
        assertFalse(Shadows.shadowOf(BluetoothAdapter.getDefaultAdapter()).hasActiveProfileProxy(BluetoothProfile.HEADSET));
        assertEquals(AudioManager.MODE_NORMAL, audio.getMode()); assertNull(audio.getCommunicationDevice());
    }
    @Test @Config(sdk = 31, shadows = StaleSpeakerAudio.class) public void android12SpeakerUsesCompatibilityControlEvenWhenModernSpeakerRequestsWouldBeIgnored() {
        available(speaker, device(AudioDeviceInfo.TYPE_BUILTIN_EARPIECE)); routes.start();
        assertEquals("true:speaker", ready()); assertTrue(audio.isSpeakerphoneOn()); assertEquals(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER, audio.getCommunicationDevice().getType());
        StaleSpeakerAudio state = Shadow.extract(audio); assertEquals(0, state.speakerRequests); assertEquals(0, state.clears); assertTrue(state.compatibilityCalls > 0); assertTrue(failures.isEmpty());
    }
    @Test @Config(sdk = 31) public void android12UnplugUsesPhysicalSpeakerEvenWhileTheCommunicationListStillContainsOnlyBluetooth() {
        available(bluetooth); shadow.setOutputDevices(Arrays.asList(speaker)); routes.start(); idle(300); assertEquals("true:bluetooth", ready());
        headsets.removeDevice(headsetDevice); context.sendBroadcast(new Intent(BluetoothHeadset.ACTION_CONNECTION_STATE_CHANGED).putExtra(BluetoothProfile.EXTRA_STATE, BluetoothProfile.STATE_DISCONNECTED)); idle(600);
        assertEquals("true:speaker", ready()); assertTrue(audio.isSpeakerphoneOn()); assertTrue(failures.isEmpty());
        long serial = generation(); idle(6000); assertEquals(serial, generation()); assertTrue(failures.isEmpty());
    }
    @Implements(BluetoothAdapter.class) public static class DelayedProfileAdapter extends org.robolectric.shadows.ShadowBluetoothAdapter {
        BluetoothProfile.ServiceListener pending;
        @Implementation protected boolean getProfileProxy(Context context, BluetoothProfile.ServiceListener listener, int profile) { pending = listener; return true; }
    }
}
