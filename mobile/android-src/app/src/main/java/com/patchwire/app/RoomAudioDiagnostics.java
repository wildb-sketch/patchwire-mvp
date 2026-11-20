package com.patchwire.app;

import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import android.os.SystemClock;
import com.getcapacitor.JSObject;
import java.util.ArrayDeque;
import org.json.JSONArray;

/** Bounded in-memory route history. No device names/addresses, room data or credentials. */
final class RoomAudioDiagnostics {
    static final String BUILD = "android-media-volume-1";
    private final long started = SystemClock.elapsedRealtime();
    private final ArrayDeque<JSObject> events = new ArrayDeque<>();
    synchronized void add(String event, String wanted, AudioManager audio) {
        JSObject item = new JSObject(); item.put("ms", SystemClock.elapsedRealtime() - started);
        item.put("event", event); item.put("wanted", wanted);
        try {
            item.put("mode", audio.getMode()); item.put("speakerphoneOn", audio.isSpeakerphoneOn());
            if (Build.VERSION.SDK_INT >= 31) Api31.read(audio, item);
        } catch (RuntimeException ignored) { item.put("stateUnavailable", true); }
        while (events.size() >= 64) events.removeFirst(); events.addLast(item);
    }
    synchronized JSObject snapshot(String route, boolean settled, long generation, String mode) {
        JSObject result = new JSObject(); result.put("build", BUILD); result.put("wanted", route);
        result.put("settled", settled); result.put("generation", generation); result.put("outputMode", mode);
        result.put("events", new JSONArray(events)); return result;
    }
    @android.annotation.TargetApi(31) private static final class Api31 {
        static void read(AudioManager audio, JSObject result) {
            AudioDeviceInfo device = audio.getCommunicationDevice(); result.put("communicationType", device == null ? 0 : device.getType());
        }
    }
}
