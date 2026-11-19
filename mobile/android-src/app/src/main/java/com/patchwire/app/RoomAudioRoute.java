package com.patchwire.app;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothHeadset;
import android.bluetooth.BluetoothProfile;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import androidx.core.content.ContextCompat;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;

/** Communication output and its matching input, owned only for the room's service lifetime. */
final class RoomAudioRoute {
    interface Listener { void changed(boolean ready, String route, long generation, boolean failed, String failedRoute); }
    interface Ready { void result(boolean managed, String route, long generation); }
    private static final AtomicLong SERIAL = new AtomicLong();
    static final long CONNECT_TIMEOUT = 30000;
    private final Context context;
    private final AudioManager audio;
    private final Listener listener;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final List<Ready> waiting = new ArrayList<>();
    private final RoomAudioDiagnostics diagnostics = new RoomAudioDiagnostics();
    private Api23 devices;
    private Api31 communication;
    private RoomBluetoothDevices bluetoothDevices;
    private boolean running, settled, modeOwned, receiverRegistered, scoRequested, scoConnected;
    private boolean previousSpeaker;
    private Boolean legacyHeadset;
    private String route = "speaker", key = "", captureKey = "", blockedBluetooth = "", failedSource = "", outputMode;
    private long generation;
    private final Runnable refresh = this::refreshNow;
    private final Runnable legacyTimeout = () -> { if (running && !settled && "bluetooth".equals(route)) { blockedBluetooth = "legacy"; legacyFallback(true); } };
    private final BroadcastReceiver receiver = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent intent) {
            if (!running) return;
            try {
            if (BluetoothHeadset.ACTION_CONNECTION_STATE_CHANGED.equals(intent.getAction())) {
                if (communication != null) { scheduleRefresh(); return; }
                legacyHeadset = intent.getIntExtra(BluetoothProfile.EXTRA_STATE, -1) == BluetoothProfile.STATE_CONNECTED;
                blockedBluetooth = ""; if (communication != null) communication.unavailable = false; scheduleRefresh();
            } else if (AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED.equals(intent.getAction()) && communication == null) {
                int state = intent.getIntExtra(AudioManager.EXTRA_SCO_AUDIO_STATE, -1);
                if (state == AudioManager.SCO_AUDIO_STATE_CONNECTED && scoRequested && "bluetooth".equals(route)) {
                    scoConnected = true; audio.setBluetoothScoOn(true); finish(false);
                } else if (state == AudioManager.SCO_AUDIO_STATE_DISCONNECTED && scoConnected) {
                    scoConnected = false; scoRequested = false; settled = false;
                    audio.setBluetoothScoOn(false); scheduleRefresh();
                }
            } else scheduleRefresh();
            } catch (RuntimeException error) { failSafely(); }
        }
    };

    RoomAudioRoute(Context context, AudioManager audio, Listener listener) {
        this.context = context; this.audio = audio; this.listener = listener; outputMode = outputMode(context);
    }
    static String outputMode(Context context) { return context.getSharedPreferences("whassabi_audio", Context.MODE_PRIVATE).getString("output_mode", "auto"); }
    static boolean validOutputMode(String mode) { return "auto".equals(mode) || "speaker".equals(mode) || "bluetooth".equals(mode); }
    static void saveOutputMode(Context context, String mode) { context.getSharedPreferences("whassabi_audio", Context.MODE_PRIVATE).edit().putString("output_mode", mode).apply(); }
    void setOutputMode(String mode) {
        if (!validOutputMode(mode)) return;
        outputMode = mode; saveOutputMode(context, mode); blockedBluetooth = "";
        if (communication != null) { communication.failedBluetooth.clear(); communication.unavailable = false; }
        refreshNow();
    }
    com.getcapacitor.JSObject diagnostics() { return diagnostics.snapshot(route, settled, generation, outputMode); }
    static boolean bluetoothAllowed(Context context) {
        return Build.VERSION.SDK_INT < 31 || ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;
    }
    void start() {
        if (running || audio == null) return;
        running = true; previousSpeaker = audio.isSpeakerphoneOn();
        diagnostics.add("start", route, audio);
        try {
            if (audio.getMode() != AudioManager.MODE_IN_CALL) { audio.setMode(AudioManager.MODE_IN_COMMUNICATION); modeOwned = true; }
            IntentFilter filter = new IntentFilter(AudioManager.ACTION_HEADSET_PLUG);
            filter.addAction(AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED); filter.addAction(BluetoothHeadset.ACTION_CONNECTION_STATE_CHANGED);
            ContextCompat.registerReceiver(context, receiver, filter, ContextCompat.RECEIVER_EXPORTED); receiverRegistered = true;
            if (Build.VERSION.SDK_INT >= 23) { devices = new Api23(); devices.start(); }
            if (Build.VERSION.SDK_INT >= 31) {
                communication = new Api31(); communication.start();
                bluetoothDevices = new RoomBluetoothDevices(context, handler, () -> { communication.failedBluetooth.clear(); communication.unavailable = false; scheduleRefresh(); });
                bluetoothDevices.start();
            }
            refreshNow();
        } catch (RuntimeException error) { android.util.Log.w("WhassabiRoom", "Unable to start room routing", error); failSafely(); }
    }
    void scheduleRefresh() {
        if (!running) return;
        handler.removeCallbacks(refresh); handler.postDelayed(refresh, 250);
    }
    void refreshNow() {
        if (!running) return;
        try {
            if (bluetoothDevices != null) bluetoothDevices.refresh();
            if (audio.getMode() == AudioManager.MODE_IN_CALL) { if (!settled) { begin("system", "call"); finish(false); } return; }
            if (audio.getMode() != AudioManager.MODE_IN_COMMUNICATION) { audio.setMode(AudioManager.MODE_IN_COMMUNICATION); modeOwned = true; }
            if (communication != null) communication.select(); else legacySelect();
        } catch (RuntimeException error) { android.util.Log.w("WhassabiRoom", "Unable to apply room routing", error); failSafely(); }
    }
    void resume() {
        if (!running) return;
        try {
            if (audio.getMode() != AudioManager.MODE_IN_CALL && audio.getMode() != AudioManager.MODE_IN_COMMUNICATION) {
                audio.setMode(AudioManager.MODE_IN_COMMUNICATION); modeOwned = true;
            }
        } catch (RuntimeException ignored) {}
        scheduleRefresh();
    }
    void awaitReady(Ready callback) {
        if (running) refreshNow();
        if (!running) callback.result(false, "system", 0);
        else if (settled) callback.result(true, route, generation);
        else waiting.add(callback);
    }
    void captureRoute(Ready callback) {
        if (running) refreshNow();
        // Android can defer communication routing until an AudioRecord/AudioTrack is active.
        // Bootstrap capture now; the confirmed-route event will replace it if necessary.
        callback.result(running, running && settled ? route : "system", running && settled ? generation : 0);
    }
    private void begin(String nextRoute, String nextKey) {
        route = nextRoute; key = nextKey; settled = false;
        String identity = "speaker".equals(nextRoute) ? "speaker" : nextKey;
        if (generation == 0 || !"system".equals(nextRoute) && !identity.equals(captureKey)) {
            generation = SERIAL.incrementAndGet(); if (!"system".equals(nextRoute)) captureKey = identity;
        }
        listener.changed(false, route, generation, false, "");
        diagnostics.add("route_pending", route, audio);
    }
    private void finish(boolean failed) {
        if (!running || settled) return;
        settled = true; handler.removeCallbacks(legacyTimeout);
        diagnostics.add(failed ? "route_failed" : "route_ready", route, audio);
        listener.changed(true, route, generation, failed, failed ? (failedSource.isEmpty() ? route : failedSource) : "");
        List<Ready> callbacks = new ArrayList<>(waiting); waiting.clear();
        for (Ready callback : callbacks) callback.result(true, route, generation);
    }
    private void failSafely() {
        if (!running) return;
        try { if (communication != null) communication.fallback(true); else legacyFallback(true); }
        catch (RuntimeException ignored) { begin("system", "system"); finish(true); }
    }
    @android.annotation.SuppressLint("MissingPermission") // Only called below API 31; BLUETOOTH is a normal legacy permission.
    private boolean legacyBluetooth() {
        if (legacyHeadset != null) return legacyHeadset;
        if (devices != null && devices.hasBluetooth()) return true;
        try { BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter(); return adapter != null && adapter.getProfileConnectionState(BluetoothProfile.HEADSET) == BluetoothAdapter.STATE_CONNECTED; }
        catch (RuntimeException ignored) { return false; }
    }
    private void legacySelect() {
        boolean wired = "auto".equals(outputMode) && (audio.isWiredHeadsetOn() || devices != null && devices.hasWired());
        boolean bluetooth = !"speaker".equals(outputMode) && !wired && legacyBluetooth() && !"legacy".equals(blockedBluetooth);
        String next = bluetooth ? "bluetooth" : wired ? "wired" : "speaker";
        if (next.equals(route) && (bluetooth ? scoRequested && (!settled || scoConnected && audio.isBluetoothScoOn()) : !settled && key.equals(next) || settled && audio.isSpeakerphoneOn() == !wired)) return;
        begin(next, next);
        if (bluetooth) {
            audio.setSpeakerphoneOn(false);
            if (audio.isBluetoothScoOn()) { scoConnected = true; scoRequested = true; finish(false); }
            else if (!audio.isBluetoothScoAvailableOffCall()) { blockedBluetooth = "legacy"; legacyFallback(true); }
            else { scoRequested = true; audio.startBluetoothSco(); handler.postDelayed(legacyTimeout, CONNECT_TIMEOUT); }
        } else legacyFallback(false);
    }
    private void legacyFallback(boolean failed) {
        failedSource = failed ? route : "";
        if (scoRequested) { audio.stopBluetoothSco(); audio.setBluetoothScoOn(false); scoRequested = false; scoConnected = false; }
        boolean wired = "auto".equals(outputMode) && (audio.isWiredHeadsetOn() || devices != null && devices.hasWired());
        String next = wired ? "wired" : "speaker";
        if (!key.equals(next) || settled) begin(next, next);
        audio.setSpeakerphoneOn(!wired);
        final long selected = generation;
        handler.postDelayed(() -> { if (running && generation == selected) finish(failed); }, 200);
    }
    void stop() {
        if (!running) return;
        running = false; handler.removeCallbacksAndMessages(null);
        diagnostics.add("stop", route, audio);
        if (devices != null) devices.stop();
        if (bluetoothDevices != null) bluetoothDevices.stop();
        if (communication != null) communication.stop();
        if (receiverRegistered) { try { context.unregisterReceiver(receiver); } catch (RuntimeException ignored) {} }
        try { if (scoRequested) { audio.stopBluetoothSco(); audio.setBluetoothScoOn(false); } } catch (RuntimeException ignored) {}
        try { if (Build.VERSION.SDK_INT < 31) audio.setSpeakerphoneOn(previousSpeaker); } catch (RuntimeException ignored) {}
        try { if (modeOwned) audio.setMode(AudioManager.MODE_NORMAL); } catch (RuntimeException ignored) {}
        for (Ready callback : new ArrayList<>(waiting)) callback.result(false, "system", 0);
        waiting.clear();
    }

    // Keep API-specific classes out of the Android 5.1 loading path.
    @android.annotation.TargetApi(23)
    private final class Api23 {
        private final AudioDeviceCallback callback = new AudioDeviceCallback() {
            @Override public void onAudioDevicesAdded(AudioDeviceInfo[] added) { scheduleRefresh(); }
            @Override public void onAudioDevicesRemoved(AudioDeviceInfo[] removed) { scheduleRefresh(); }
        };
        void start() { audio.registerAudioDeviceCallback(callback, handler); }
        void stop() { try { audio.unregisterAudioDeviceCallback(callback); } catch (RuntimeException ignored) {} }
        boolean hasBluetooth() { for (AudioDeviceInfo device : audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) if (isBluetooth(device.getType())) return true; return false; }
        boolean hasWired() { for (AudioDeviceInfo device : audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) if (isWired(device.getType())) return true; return false; }
    }
    // Inlined AudioDeviceInfo types keep these predicates usable on pre-23 Android.
    static boolean isBluetooth(int type) { return type == 7 || type == 26 || type == 27 || type == 23; }
    static boolean isWired(int type) { return type == 3 || type == 4 || type == 11 || type == 12 || type == 22; }
    private static String kind(int type) { return isBluetooth(type) ? "bluetooth" : isWired(type) ? "wired" : "speaker"; }
    @android.annotation.TargetApi(31)
    private final class Api31 {
        private AudioDeviceInfo requested;
        private long deadline, lastRequest;
        private int requests;
        private static final long PHONE_TIMEOUT = 2000, HEADSET_TIMEOUT = 5000, RETRY_INTERVAL = 250;
        private static final int MAX_REQUESTS = 4;
        private boolean failedRoute, fallbackPending, unavailable;
        private String failedInventory = "";
        private final java.util.Set<String> failedBluetooth = new java.util.HashSet<>();
        private final Runnable check = () -> { try { check(); } catch (RuntimeException error) { failSafely(); } };
        private final AudioManager.OnModeChangedListener modeChanged = mode -> {
            if (mode != AudioManager.MODE_IN_COMMUNICATION && mode != AudioManager.MODE_IN_CALL) scheduleRefresh();
        };
        private final AudioManager.OnCommunicationDeviceChangedListener changed = device -> {
            if (!running) return;
            try {
            if (!settled) check();
            else if (device != null && !same(device, requested)) {
                unavailable = false;
                // WebView may restore its default when an AudioRecord is released/recreated.
                // Reassert the same physical route without requesting another capture restart.
                scheduleRefresh();
            } else if (device == null || "system".equals(route)) { unavailable = false; scheduleRefresh(); }
            } catch (RuntimeException error) { failSafely(); }
        };
        void start() {
            audio.addOnCommunicationDeviceChangedListener(handler::post, changed);
            audio.addOnModeChangedListener(handler::post, modeChanged);
        }
        void stop() {
            try { audio.removeOnCommunicationDeviceChangedListener(changed); } catch (RuntimeException ignored) {}
            try { audio.removeOnModeChangedListener(modeChanged); } catch (RuntimeException ignored) {}
            try { audio.clearCommunicationDevice(); } catch (RuntimeException ignored) {}
            try { if (Build.VERSION.SDK_INT <= 32 && audio.getMode() != AudioManager.MODE_IN_CALL) audio.setSpeakerphoneOn(previousSpeaker); } catch (RuntimeException ignored) {}
        }
        boolean phoneCompat() { return Build.VERSION.SDK_INT <= 32 && requested != null && requested.getType() == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER; }
        boolean confirmed() { return phoneCompat() && audio.isSpeakerphoneOn() || same(audio.getCommunicationDevice(), requested); }
        AudioDeviceInfo phoneSpeaker() {
            for (AudioDeviceInfo device : audio.getAvailableCommunicationDevices()) if (device.getType() == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) return device;
            // Android 12 can temporarily omit the speaker from the communication list on HFP removal.
            if (Build.VERSION.SDK_INT <= 32) for (AudioDeviceInfo device : audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) if (device.getType() == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) return device;
            return null;
        }
        void select() {
            List<AudioDeviceInfo> available = audio.getAvailableCommunicationDevices();
            if (unavailable && inventory(available).equals(failedInventory) && !confirmed()) return;
            unavailable = false;
            AudioDeviceInfo choice = null; int best = -1;
            for (AudioDeviceInfo device : available) {
                int type = device.getType();
                if ("speaker".equals(outputMode) && type != AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) continue;
                if ("bluetooth".equals(outputMode) && isWired(type)) continue;
                if (isBluetooth(type) && (!bluetoothAllowed(context) || failedBluetooth.contains(bluetoothKey(device)))) continue;
                if (type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO && (bluetoothDevices == null || !bluetoothDevices.permits(device, "bluetooth".equals(outputMode)))) continue;
                // The room's automatic phone route is the loudspeaker, never the quiet call earpiece.
                int score = isWired(type) ? 300 : isBluetooth(type) ? 200 : type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER ? 100 : -1;
                if (score < 0) continue;
                if (score > best || score == best && same(device, audio.getCommunicationDevice())) { choice = device; best = score; }
            }
            if (choice == null) choice = phoneSpeaker();
            if (choice == null) { if (!settled) { begin("system", "system"); finish(true); } return; }
            if (same(choice, requested) && !settled) { check(); return; }
            if (same(choice, requested) && confirmed() && kind(choice.getType()).equals(route)) return;
            boolean sameRoute = same(choice, requested) && kind(choice.getType()).equals(route);
            requested = choice; failedRoute = false; fallbackPending = false; failedSource = ""; requests = 0;
            if (sameRoute) settled = false; else begin(kind(choice.getType()), deviceKey(choice));
            handler.removeCallbacks(check);
            deadline = SystemClock.uptimeMillis() + (isBluetooth(choice.getType()) ? HEADSET_TIMEOUT : PHONE_TIMEOUT);
            if (!request(false) && !request(true)) { fallback(true); return; }
            check();
        }
        boolean request(boolean clear) {
            lastRequest = SystemClock.uptimeMillis(); requests++;
            if (phoneCompat()) {
                // Android 12/12L's speakerphone API does not require a live HFP communication port.
                // Use it as the single phone-output control on these versions; do not clear it
                // while switching out of a disconnected Bluetooth route.
                audio.setSpeakerphoneOn(true); diagnostics.add("speakerphone_compat", route, audio); return true;
            }
            if (Build.VERSION.SDK_INT <= 32 && requests == 1 && audio.isSpeakerphoneOn()) audio.setSpeakerphoneOn(false);
            if (clear) audio.clearCommunicationDevice();
            diagnostics.add(clear ? "communication_reapply" : "communication_request", route, audio);
            return requested != null && audio.setCommunicationDevice(requested);
        }
        void check() {
            handler.removeCallbacks(check);
            if (!running || settled) return;
            if (audio.getMode() == AudioManager.MODE_IN_CALL) { handler.postDelayed(check, 250); return; }
            if (audio.getMode() != AudioManager.MODE_IN_COMMUNICATION) { audio.setMode(AudioManager.MODE_IN_COMMUNICATION); modeOwned = true; }
            if (confirmed()) { finish(failedRoute); return; }
            if (SystemClock.uptimeMillis() >= deadline) {
                if (!fallbackPending) fallback(true);
                else {
                    // Keep the requested loudspeaker preference. Clearing it here exposes Android's
                    // call earpiece and starts another WebView/output recovery cycle.
                    unavailable = true; failedInventory = inventory(audio.getAvailableCommunicationDevices()); begin("system", "system"); finish(true);
                }
                return;
            }
            // WebView can overwrite the first speaker request during AudioRecord startup.
            // Clear that stale preference and reapply it promptly without extending the deadline
            // or creating a new capture generation. Do not restart Bluetooth handshakes here.
            if (requested != null && !isBluetooth(requested.getType()) && requests < MAX_REQUESTS && SystemClock.uptimeMillis() - lastRequest >= RETRY_INTERVAL) {
                request(true);
                if (confirmed()) { finish(failedRoute); return; }
            }
            handler.postDelayed(check, 250);
        }
        void fallback(boolean failed) {
            handler.removeCallbacks(check);
            if (!fallbackPending) failedSource = requested == null ? "system" : kind(requested.getType());
            if (requested != null && isBluetooth(requested.getType())) failedBluetooth.add(bluetoothKey(requested));
            requested = phoneSpeaker(); diagnostics.add("speaker_fallback", route, audio);
            // Recovering the requested phone speaker is success, not a headset failure.
            failedRoute = failed && !"speaker".equals(failedSource); fallbackPending = true; requests = 0;
            begin(requested == null ? "system" : "speaker", requested == null ? "system" : deviceKey(requested));
            if (requested != null && request(false)) { deadline = SystemClock.uptimeMillis() + PHONE_TIMEOUT; check(); }
            else { unavailable = true; failedInventory = inventory(audio.getAvailableCommunicationDevices()); begin("system", "system"); finish(failed); }
        }
        String inventory(List<AudioDeviceInfo> available) {
            java.util.TreeSet<String> keys = new java.util.TreeSet<>(); for (AudioDeviceInfo device : available) keys.add(deviceKey(device));
            return keys.toString() + bluetoothAllowed(context);
        }
        boolean same(AudioDeviceInfo a, AudioDeviceInfo b) { return a != null && b != null && a.getId() == b.getId() && a.getType() == b.getType(); }
        String deviceKey(AudioDeviceInfo device) { return device.getType() + ":" + device.getId(); }
        String bluetoothKey(AudioDeviceInfo device) {
            String address = RoomBluetoothDevices.normalize(device.getAddress());
            return device.getType() + ":" + (address.isEmpty() ? "unidentified" : address);
        }
    }
}
