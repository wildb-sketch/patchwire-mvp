package com.patchwire.app;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.media.AudioRecordingConfiguration;
import android.os.Build;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import org.json.JSONArray;
import java.util.LinkedHashSet;

/** Local diagnostics: an output request is never treated as proof of the recording input. */
final class RoomAudioStatus {
    static JSObject read(Context context) {
        JSObject result = new JSObject(); result.put("input", "unknown"); result.put("output", "system");
        result.put("inputVerified", false); result.put("headsetNames", new JSONArray());
        AudioManager audio = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        if (audio == null) return result;
        try {
            if (Build.VERSION.SDK_INT >= 31) Api31.output(audio, result);
            else result.put("output", audio.isBluetoothScoOn() ? "bluetooth" : audio.isWiredHeadsetOn() ? "wired" : audio.isSpeakerphoneOn() ? "speaker" : "system");
        } catch (RuntimeException ignored) { /* Output may be unavailable while recording information is readable. */ }
        try { if (Build.VERSION.SDK_INT >= 23) Api23.names(audio, result); } catch (RuntimeException ignored) {}
        try {
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) result.put("input", "permission");
            else if (Build.VERSION.SDK_INT >= 24) Api24.recordings(audio, result);
        } catch (RuntimeException ignored) { /* Unknown remains unknown; never invent a confirmed headset mic. */ }
        return result;
    }
    static String kind(int type) {
        if (RoomAudioRoute.isBluetooth(type)) return "bluetooth";
        if (RoomAudioRoute.isWired(type)) return "wired";
        return type == 15 ? "phone" : "other";
    }
    @android.annotation.TargetApi(23) private static final class Api23 {
        static void names(AudioManager audio, JSObject result) {
            JSONArray names = new JSONArray();
            for (AudioDeviceInfo device : audio.getDevices(AudioManager.GET_DEVICES_INPUTS)) if (RoomAudioRoute.isBluetooth(device.getType())) {
                CharSequence product = device.getProductName();
                if (product != null) names.put(product.toString().substring(0, Math.min(120, product.length())));
            }
            result.put("headsetNames", names);
        }
    }
    @android.annotation.TargetApi(24) private static final class Api24 {
        static void recordings(AudioManager audio, JSObject result) {
            LinkedHashSet<String> inputs = new LinkedHashSet<>(); boolean active = false, silenced = false, missing = false;
            for (AudioRecordingConfiguration recording : audio.getActiveRecordingConfigurations()) {
                // Other apps' recordings are anonymized. Do not describe or return their sessions.
                if (recording.getClientAudioSessionId() <= 0) continue;
                active = true; AudioDeviceInfo device = recording.getAudioDevice();
                if (device != null) inputs.add(kind(device.getType())); else missing = true;
                if (Build.VERSION.SDK_INT >= 29 && recording.isClientSilenced()) silenced = true;
            }
            result.put("input", inputs.size() > 1 ? "multiple" : missing ? "unknown" : inputs.size() == 1 ? inputs.iterator().next() : active ? "unknown" : "inactive");
            result.put("inputVerified", inputs.size() == 1 && !missing); result.put("silenced", silenced);
        }
    }
    @android.annotation.TargetApi(31) private static final class Api31 {
        static void output(AudioManager audio, JSObject result) {
            AudioDeviceInfo device = audio.getCommunicationDevice(); if (device == null) return;
            int type = device.getType(); result.put("output", RoomAudioRoute.isBluetooth(type) ? "bluetooth" : RoomAudioRoute.isWired(type) ? "wired" : "speaker");
            if (RoomAudioRoute.isBluetooth(type)) result.put("outputName", String.valueOf(device.getProductName()));
        }
    }
}
