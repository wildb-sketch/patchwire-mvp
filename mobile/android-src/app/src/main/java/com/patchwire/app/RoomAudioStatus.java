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
        result.put("outputMode", RoomAudioRoute.outputMode(context));
        result.put("audioBuild", RoomAudioDiagnostics.BUILD); result.put("routing", RoomService.audioDiagnostics());
        JSObject platform = new JSObject(); platform.put("manufacturer", Build.MANUFACTURER); platform.put("model", Build.MODEL);
        platform.put("android", Build.VERSION.RELEASE); platform.put("sdk", Build.VERSION.SDK_INT); result.put("platform", platform);
        if (Build.VERSION.SDK_INT >= 26) Api26.webView(result);
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
            boolean speakerOn = audio.isSpeakerphoneOn(); result.put("speakerphoneOn", speakerOn); result.put("audioMode", audio.getMode());
            if (Build.VERSION.SDK_INT <= 32 && speakerOn) result.put("output", "speaker");
            AudioDeviceInfo device = audio.getCommunicationDevice(); if (device == null) { result.put("communicationType", 0); return; }
            int type = device.getType(); result.put("communicationType", type);
            result.put("output", Build.VERSION.SDK_INT <= 32 && speakerOn ? "speaker" : RoomAudioRoute.isBluetooth(type) ? "bluetooth" : RoomAudioRoute.isWired(type) ? "wired" : type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER ? "speaker" : type == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE ? "earpiece" : "system");
            if ("bluetooth".equals(result.getString("output"))) result.put("outputName", String.valueOf(device.getProductName()));
        }
    }
    @android.annotation.TargetApi(26) private static final class Api26 {
        static void webView(JSObject result) { try { android.content.pm.PackageInfo info = android.webkit.WebView.getCurrentWebViewPackage(); if (info != null) result.put("webViewVersion", info.versionName); } catch (RuntimeException ignored) {} }
    }
}
