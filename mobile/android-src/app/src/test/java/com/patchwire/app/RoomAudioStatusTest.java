package com.patchwire.app;

import android.Manifest;
import android.app.Application;
import android.content.Context;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.media.AudioRecordingConfiguration;
import android.media.MediaRecorder;
import com.getcapacitor.JSObject;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.Implementation;
import org.robolectric.annotation.Implements;
import org.robolectric.annotation.RealObject;
import org.robolectric.shadows.AudioDeviceInfoBuilder;
import org.robolectric.shadows.ShadowAudioManager;
import org.robolectric.util.ReflectionHelpers;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34, manifest = Config.NONE, shadows = RoomAudioStatusTest.RecordingShadow.class)
public class RoomAudioStatusTest {
    private Application context;
    private ShadowAudioManager shadow;
    private AudioDeviceInfo phone, bluetooth;
    private static final Map<Integer, AudioDeviceInfo> inputs = new HashMap<>();
    @Before public void setup() {
        inputs.clear(); context = RuntimeEnvironment.getApplication();
        Shadows.shadowOf(context).grantPermissions(Manifest.permission.RECORD_AUDIO, Manifest.permission.BLUETOOTH_CONNECT);
        AudioManager audio = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE); shadow = Shadows.shadowOf(audio);
        phone = AudioDeviceInfoBuilder.newBuilder().setType(AudioDeviceInfo.TYPE_BUILTIN_MIC).build();
        // Robolectric 4.13's builder only maps output types. Supply the real built-in input port.
        ReflectionHelpers.setField(ReflectionHelpers.getField(phone, "mPort"), "mType", 0x80000004);
        assertEquals(AudioDeviceInfo.TYPE_BUILTIN_MIC, phone.getType());
        bluetooth = AudioDeviceInfoBuilder.newBuilder().setType(AudioDeviceInfo.TYPE_BLUETOOTH_SCO).build();
        shadow.setAvailableCommunicationDevices(Arrays.asList(bluetooth)); audio.setCommunicationDevice(bluetooth);
    }
    private AudioRecordingConfiguration recording(int session, AudioDeviceInfo input) {
        inputs.put(session, input);
        return shadow.createActiveRecordingConfiguration(session, MediaRecorder.AudioSource.VOICE_COMMUNICATION, "fixture.private.package");
    }
    @Test public void selectedBluetoothOutputDoesNotPretendThePhoneRecordingUsesTheHeadsetMic() {
        shadow.setActiveRecordingConfigurations(Arrays.asList(recording(11, phone)), false);
        JSObject status = RoomAudioStatus.read(context);
        assertEquals("bluetooth", status.getString("output")); assertEquals("phone", status.getString("input"));
        assertTrue(status.getBool("inputVerified")); assertFalse(status.toString().contains("fixture.private.package"));
    }
    @Test public void actualBluetoothRecordingConfirmsTheInput() {
        shadow.setActiveRecordingConfigurations(Arrays.asList(recording(12, bluetooth)), false);
        JSObject status = RoomAudioStatus.read(context);
        assertEquals("bluetooth", status.getString("input")); assertTrue(status.getBool("inputVerified"));
    }
    @Test public void anonymizedSessionsAndMissingDeviceInformationCannotConfirmAHeadsetMic() {
        shadow.setActiveRecordingConfigurations(Arrays.asList(recording(0, bluetooth)), false);
        JSObject status = RoomAudioStatus.read(context); assertEquals("inactive", status.getString("input")); assertFalse(status.getBool("inputVerified"));
        shadow.setActiveRecordingConfigurations(Arrays.asList(recording(13, null)), false);
        status = RoomAudioStatus.read(context); assertEquals("unknown", status.getString("input")); assertFalse(status.getBool("inputVerified"));
        shadow.setActiveRecordingConfigurations(Arrays.asList(recording(13, null), recording(16, bluetooth)), false);
        status = RoomAudioStatus.read(context); assertEquals("unknown", status.getString("input")); assertFalse(status.getBool("inputVerified"));
    }
    @Test public void multipleDifferentInputsRemainAmbiguous() {
        shadow.setActiveRecordingConfigurations(Arrays.asList(recording(14, phone), recording(15, bluetooth)), false);
        JSObject status = RoomAudioStatus.read(context); assertEquals("multiple", status.getString("input")); assertFalse(status.getBool("inputVerified"));
    }
    @Test public void callEarpieceAndLoudspeakerAreReportedAsDifferentOutputs() {
        AudioManager audio = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        AudioDeviceInfo earpiece = AudioDeviceInfoBuilder.newBuilder().setType(AudioDeviceInfo.TYPE_BUILTIN_EARPIECE).build();
        AudioDeviceInfo speaker = AudioDeviceInfoBuilder.newBuilder().setType(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER).build();
        shadow.setAvailableCommunicationDevices(Arrays.asList(earpiece, speaker));
        audio.setCommunicationDevice(earpiece); assertEquals("earpiece", RoomAudioStatus.read(context).getString("output"));
        audio.setCommunicationDevice(speaker); assertEquals("speaker", RoomAudioStatus.read(context).getString("output"));
    }
    @Test @Config(sdk = 31) public void android12SpeakerphoneOverrideDoesNotReportStaleBluetoothAsTheOutput() {
        AudioManager audio = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        audio.setSpeakerphoneOn(true);
        JSObject status = RoomAudioStatus.read(context);
        assertEquals("speaker", status.getString("output")); assertTrue(status.getBool("speakerphoneOn"));
        assertEquals(AudioDeviceInfo.TYPE_BLUETOOTH_SCO, status.getInteger("communicationType").intValue());
        assertFalse(status.has("outputName")); assertFalse(status.getBool("inputVerified"));
    }
    @Implements(AudioRecordingConfiguration.class) public static class RecordingShadow {
        @RealObject AudioRecordingConfiguration real;
        @Implementation protected AudioDeviceInfo getAudioDevice() { return inputs.get(real.getClientAudioSessionId()); }
    }
}
