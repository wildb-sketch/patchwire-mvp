package com.patchwire.app;

import android.Manifest;
import android.app.Application;
import android.bluetooth.BluetoothHeadset;
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
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34, manifest = Config.NONE)
@LooperMode(LooperMode.Mode.PAUSED)
public class RoomAudioRouteTest {
    private Application context;
    private AudioManager audio;
    private ShadowAudioManager shadow;
    private RoomAudioRoute routes;
    private final List<String> events = new ArrayList<>();
    private AudioDeviceInfo speaker, bluetooth, wired;
    @Before public void setup() {
        context = RuntimeEnvironment.getApplication(); Shadows.shadowOf(context).grantPermissions(Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH);
        audio = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE); shadow = Shadows.shadowOf(audio);
        speaker = device(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER); bluetooth = device(AudioDeviceInfo.TYPE_BLUETOOTH_SCO); wired = device(AudioDeviceInfo.TYPE_WIRED_HEADSET);
        audio.setMode(AudioManager.MODE_NORMAL); audio.setSpeakerphoneOn(false); audio.setBluetoothScoOn(false);
        routes = new RoomAudioRoute(context, audio, (ready, route, generation, failed) -> events.add(ready + ":" + route + ":" + generation + ":" + failed));
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
        available(speaker, bluetooth); routes.start(); assertEquals("true:bluetooth", ready());
        assertFalse(audio.isBluetoothScoOn());
        context.sendBroadcast(new Intent(AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED).putExtra(AudioManager.EXTRA_SCO_AUDIO_STATE, AudioManager.SCO_AUDIO_STATE_DISCONNECTED)); idle(300);
        assertEquals("true:bluetooth", ready());
        shadow.removeAvailableCommunicationDevice(bluetooth, true); idle(300); assertEquals("true:speaker", ready());
        routes.stop(); assertEquals(AudioManager.MODE_NORMAL, audio.getMode());
    }
    @Test @Config(sdk = 31, shadows = DelayedAudio.class) public void captureCanStartBeforeAndroidFinishesTheBluetoothRoute() {
        available(speaker, bluetooth); routes.start(); assertNull(ready());
        final String[] capture = {null}; final long[] generation = {-1};
        routes.captureRoute((managed, route, serial) -> { capture[0] = managed + ":" + route; generation[0] = serial; });
        assertEquals("true:system", capture[0]); assertEquals(0, generation[0]);
        // An OEM can defer this confirmation until the app has started AudioRecord.
        DelayedAudio delayed = Shadow.extract(audio); delayed.confirm(); idle(300);
        routes.captureRoute((managed, route, serial) -> { capture[0] = managed + ":" + route; generation[0] = serial; });
        assertEquals("true:bluetooth", capture[0]); assertTrue(generation[0] > 0);
        routes.stop(); routes.captureRoute((managed, route, serial) -> assertFalse(managed));
    }
    @Implements(AudioManager.class) public static class ModernOnlyAudio extends ShadowAudioManager {
        @Implementation protected void startBluetoothSco() { throw new AssertionError("Do not mix legacy SCO with setCommunicationDevice on Android 12+"); }
    }
    @Test @Config(sdk = 31) public void disconnectingTheHeadsetReturnsToLoudspeakerEvenWhileTheDeviceListIsStale() {
        AudioDeviceInfo earpiece = device(AudioDeviceInfo.TYPE_BUILTIN_EARPIECE);
        available(earpiece, speaker, bluetooth); routes.start(); assertEquals("true:bluetooth", ready());
        context.sendBroadcast(new Intent(BluetoothHeadset.ACTION_CONNECTION_STATE_CHANGED).putExtra(BluetoothProfile.EXTRA_STATE, BluetoothProfile.STATE_DISCONNECTED)); idle(300);
        assertEquals("true:speaker", ready()); assertEquals(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER, audio.getCommunicationDevice().getType());
        routes.refreshNow(); idle(500); assertEquals("true:speaker", ready());
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
    @Implements(AudioManager.class) public static class DelayedAudio extends ShadowAudioManager {
        boolean delay = true;
        private AudioDeviceInfo requested;
        @Implementation protected boolean setCommunicationDevice(AudioDeviceInfo device) { requested = device; return delay || super.setCommunicationDevice(device); }
        void confirm() { delay = false; super.setCommunicationDevice(requested); }
    }
}
