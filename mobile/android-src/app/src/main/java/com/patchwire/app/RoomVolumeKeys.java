package com.patchwire.app;

import android.media.AudioManager;
import android.view.KeyEvent;

/** HTML audio playback uses media volume even while capture owns communication mode. */
final class RoomVolumeKeys {
    static boolean handle(AudioManager audio, boolean roomActive, KeyEvent event) {
        int key = event.getKeyCode(), action = event.getAction();
        if (!roomActive || audio == null || (key != KeyEvent.KEYCODE_VOLUME_UP && key != KeyEvent.KEYCODE_VOLUME_DOWN)
                || (action != KeyEvent.ACTION_DOWN && action != KeyEvent.ACTION_UP)) return false;
        try {
            int mode = audio.getMode();
            if (mode != AudioManager.MODE_NORMAL && mode != AudioManager.MODE_IN_COMMUNICATION) return false;
            // Suggested-stream dispatch can choose voice-call volume in communication mode.
            // Address media explicitly; repeated DOWN events support holding the button.
            if (action == KeyEvent.ACTION_DOWN && !event.isCanceled()) {
                audio.adjustStreamVolume(AudioManager.STREAM_MUSIC,
                    key == KeyEvent.KEYCODE_VOLUME_UP ? AudioManager.ADJUST_RAISE : AudioManager.ADJUST_LOWER,
                    AudioManager.FLAG_SHOW_UI);
            }
            return true;
        } catch (RuntimeException ignored) { return false; }
    }
}
