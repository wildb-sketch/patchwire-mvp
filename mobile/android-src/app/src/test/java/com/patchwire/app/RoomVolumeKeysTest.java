package com.patchwire.app;

import android.content.Context;
import android.media.AudioManager;
import android.view.KeyEvent;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.Implementation;
import org.robolectric.annotation.Implements;
import org.robolectric.shadow.api.Shadow;
import org.robolectric.shadows.ShadowAudioManager;
import java.util.ArrayList;
import java.util.List;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = {28, 31, 34}, manifest = Config.NONE, shadows = RoomVolumeKeysTest.VolumeAudio.class)
public class RoomVolumeKeysTest {
    private AudioManager audio;
    private VolumeAudio calls;
    @Before public void setup() {
        audio = (AudioManager) RuntimeEnvironment.getApplication().getSystemService(Context.AUDIO_SERVICE);
        calls = Shadow.extract(audio);
        audio.setMode(AudioManager.MODE_IN_COMMUNICATION);
        audio.setStreamVolume(AudioManager.STREAM_MUSIC, 2, 0);
        audio.setStreamVolume(AudioManager.STREAM_VOICE_CALL, 1, 0);
    }
    private KeyEvent key(int action, int code) { return new KeyEvent(action, code); }
    @Test public void buttonsChangeMediaInNormalAndCommunicationModeWithoutChangingCallVolumeOrMicrophone() {
        for (int mode : new int[] {AudioManager.MODE_NORMAL, AudioManager.MODE_IN_COMMUNICATION}) {
            audio.setMode(mode); calls.adjustments.clear();
            assertTrue(RoomVolumeKeys.handle(audio, true, key(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_VOLUME_UP)));
            assertArrayEquals(new int[] {AudioManager.STREAM_MUSIC, AudioManager.ADJUST_RAISE, AudioManager.FLAG_SHOW_UI}, calls.adjustments.get(0));
            assertEquals(mode, audio.getMode()); assertFalse(audio.isMicrophoneMute());
            assertTrue(RoomVolumeKeys.handle(audio, true, key(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_VOLUME_DOWN)));
            assertArrayEquals(new int[] {AudioManager.STREAM_MUSIC, AudioManager.ADJUST_LOWER, AudioManager.FLAG_SHOW_UI}, calls.adjustments.get(1));
            assertTrue(RoomVolumeKeys.handle(audio, true, key(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_VOLUME_DOWN)));
            assertEquals(2, calls.adjustments.size());
        }
    }
    @Test public void heldButtonsRepeatOncePerDownEventWithoutAdjustingAgainOnRelease() {
        for (int repeat = 0; repeat < 3; repeat++) assertTrue(RoomVolumeKeys.handle(audio, true,
            new KeyEvent(0, repeat, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_VOLUME_UP, repeat)));
        assertTrue(RoomVolumeKeys.handle(audio, true, key(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_VOLUME_UP)));
        assertEquals(3, calls.adjustments.size());
        for (int[] adjustment : calls.adjustments) assertArrayEquals(new int[] {AudioManager.STREAM_MUSIC, AudioManager.ADJUST_RAISE, AudioManager.FLAG_SHOW_UI}, adjustment);
    }
    @Test public void leavingTheRoomRestoresNormalDispatchAndUnrelatedKeysAreNeverConsumed() {
        assertFalse(RoomVolumeKeys.handle(audio, false, key(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_VOLUME_UP)));
        assertFalse(RoomVolumeKeys.handle(audio, false, key(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_VOLUME_UP)));
        assertFalse(RoomVolumeKeys.handle(audio, true, key(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_BACK)));
        assertFalse(RoomVolumeKeys.handle(audio, true, key(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_VOLUME_MUTE)));
        assertFalse(RoomVolumeKeys.handle(null, true, key(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_VOLUME_UP)));
        assertTrue(calls.adjustments.isEmpty());
    }
    @Test public void ringingAndTelephoneCallsRetainSystemVolumeHandling() {
        for (int mode : new int[] {AudioManager.MODE_RINGTONE, AudioManager.MODE_IN_CALL}) {
            audio.setMode(mode);
            assertFalse(RoomVolumeKeys.handle(audio, true, key(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_VOLUME_UP)));
            assertFalse(RoomVolumeKeys.handle(audio, true, key(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_VOLUME_UP)));
            assertTrue(calls.adjustments.isEmpty()); assertEquals(mode, audio.getMode());
        }
    }
    // Record the actual Android API boundary. Robolectric 4.13's default adjustStreamVolume
    // incorrectly calls its all-stream setter; it cannot test per-stream volume isolation.
    @Implements(AudioManager.class) public static class VolumeAudio extends ShadowAudioManager {
        final List<int[]> adjustments = new ArrayList<>();
        @Implementation protected void adjustStreamVolume(int stream, int direction, int flags) { adjustments.add(new int[] {stream, direction, flags}); }
    }
}
