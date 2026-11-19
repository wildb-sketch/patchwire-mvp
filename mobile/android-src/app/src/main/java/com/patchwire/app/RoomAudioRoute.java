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
    interface Listener { void changed(boolean ready, String route, long generation, boolean failed); }
    interface Ready { void result(boolean managed, String route, long generation); }
    private static final AtomicLong SERIAL = new AtomicLong();
    static final long CONNECT_TIMEOUT = 30000;
    private final Context context;
    private final AudioManager audio;
    private final Listener listener;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final List<Ready> waiting = new ArrayList<>();
    private Api23 devices;
    private Api31 communication;
    private boolean running, settled, modeOwned, receiverRegistered, scoRequested, scoConnected;
    private boolean previousSpeaker;
    private Boolean legacyHeadset;
    private String route = "speaker", key = "", blockedBluetooth = "";
    private long generation;
    private final Runnable refresh = this::refreshNow;
    private final Runnable legacyTimeout = () -> { if (running && !settled && "bluetooth".equals(route)) { blockedBluetooth = "legacy"; legacyFallback(true); } };
    private final BroadcastReceiver receiver = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent intent) {
            if (!running) return;
            try {
            if (BluetoothHeadset.ACTION_CONNECTION_STATE_CHANGED.equals(intent.getAction())) {
                legacyHeadset = intent.getIntExtra(BluetoothProfile.EXTRA_STATE, -1) == BluetoothProfile.STATE_CONNECTED;
                blockedBluetooth = ""; if (communication != null) communication.unavailable = false; scheduleRefresh();
            } else if (AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED.equals(intent.getAction())) {
                int state = intent.getIntExtra(AudioManager.EXTRA_SCO_AUDIO_STATE, -1);
                if (communication != null) {
                    boolean wasConnected = scoConnected; scoConnected = state == AudioManager.SCO_AUDIO_STATE_CONNECTED;
                    if (communication.needsSco()) {
                        if (scoConnected) { audio.setBluetoothScoOn(true); communication.check(); }
                        else if (wasConnected && state == AudioManager.SCO_AUDIO_STATE_DISCONNECTED) communication.reconnectSco();
                    }
                    return;
                }
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
        this.context = context; this.audio = audio; this.listener = listener;
    }
    static boolean bluetoothAllowed(Context context) {
        return Build.VERSION.SDK_INT < 31 || ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;
    }
    void start() {
        if (running || audio == null) return;
        running = true; previousSpeaker = audio.isSpeakerphoneOn();
        try {
            if (audio.getMode() != AudioManager.MODE_IN_CALL) { audio.setMode(AudioManager.MODE_IN_COMMUNICATION); modeOwned = true; }
            IntentFilter filter = new IntentFilter(AudioManager.ACTION_HEADSET_PLUG);
            filter.addAction(AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED); filter.addAction(BluetoothHeadset.ACTION_CONNECTION_STATE_CHANGED);
            ContextCompat.registerReceiver(context, receiver, filter, ContextCompat.RECEIVER_EXPORTED); receiverRegistered = true;
            if (Build.VERSION.SDK_INT >= 23) { devices = new Api23(); devices.start(); }
            if (Build.VERSION.SDK_INT >= 31) { communication = new Api31(); communication.start(); }
            refreshNow();
        } catch (RuntimeException error) { failSafely(); }
    }
    void scheduleRefresh() {
        if (!running) return;
        handler.removeCallbacks(refresh); handler.postDelayed(refresh, 250);
    }
    void refreshNow() {
        if (!running) return;
        try {
            if (audio.getMode() == AudioManager.MODE_IN_CALL) { if (!settled) { begin("system", "call"); finish(false); } return; }
            if (audio.getMode() != AudioManager.MODE_IN_COMMUNICATION) { audio.setMode(AudioManager.MODE_IN_COMMUNICATION); modeOwned = true; }
            if (communication != null) communication.select(); else legacySelect();
        } catch (RuntimeException error) { failSafely(); }
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
    private void begin(String nextRoute, String nextKey) {
        route = nextRoute; key = nextKey; settled = false; generation = SERIAL.incrementAndGet();
        listener.changed(false, route, generation, false);
    }
    private void finish(boolean failed) {
        if (!running || settled) return;
        settled = true; handler.removeCallbacks(legacyTimeout);
        listener.changed(true, route, generation, failed);
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
        boolean wired = audio.isWiredHeadsetOn() || devices != null && devices.hasWired();
        boolean bluetooth = !wired && legacyBluetooth() && !"legacy".equals(blockedBluetooth);
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
        if (scoRequested) { audio.stopBluetoothSco(); audio.setBluetoothScoOn(false); scoRequested = false; scoConnected = false; }
        boolean wired = audio.isWiredHeadsetOn() || devices != null && devices.hasWired();
        String next = wired ? "wired" : "speaker";
        if (!key.equals(next) || settled) begin(next, next);
        audio.setSpeakerphoneOn(!wired);
        final long selected = generation;
        handler.postDelayed(() -> { if (running && generation == selected) finish(failed); }, 200);
    }
    void stop() {
        if (!running) return;
        running = false; handler.removeCallbacksAndMessages(null);
        if (devices != null) devices.stop();
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
        private long deadline;
        private boolean failedRoute, fallbackPending, unavailable;
        private String failedInventory = "";
        private final Runnable check = this::check;
        private final AudioManager.OnCommunicationDeviceChangedListener changed = device -> {
            if (!running) return;
            if (!settled) { if (same(device, requested)) check(); }
            else if (device != null && !same(device, requested)) {
                unavailable = false;
                if (isBluetooth(device.getType()) && deviceKey(device).equals(blockedBluetooth)) blockedBluetooth = "";
                // WebView may restore its default when an AudioRecord is released/recreated.
                // Reassert the same physical route without requesting another capture restart.
                scheduleRefresh();
            } else if (device == null) scheduleRefresh();
        };
        void start() { audio.addOnCommunicationDeviceChangedListener(handler::post, changed); }
        void stop() {
            try { audio.removeOnCommunicationDeviceChangedListener(changed); } catch (RuntimeException ignored) {}
            try { audio.clearCommunicationDevice(); } catch (RuntimeException ignored) {}
        }
        boolean needsSco() { return Build.VERSION.SDK_INT <= 32 && requested != null && requested.getType() == AudioDeviceInfo.TYPE_BLUETOOTH_SCO; }
        void startSco() { if (needsSco() && !scoRequested) { scoRequested = true; audio.startBluetoothSco(); } }
        void stopSco() { if (scoRequested) { scoRequested = false; scoConnected = false; audio.stopBluetoothSco(); audio.setBluetoothScoOn(false); } }
        void reconnectSco() {
            if (!running || !needsSco()) return;
            stopSco(); begin("bluetooth", deviceKey(requested)); startSco();
            deadline = SystemClock.uptimeMillis() + CONNECT_TIMEOUT; handler.removeCallbacks(check); check();
        }
        void select() {
            List<AudioDeviceInfo> available = audio.getAvailableCommunicationDevices();
            if (unavailable && inventory(available).equals(failedInventory)) return;
            unavailable = false;
            if (available.stream().noneMatch(d -> deviceKey(d).equals(blockedBluetooth))) blockedBluetooth = "";
            AudioDeviceInfo choice = null; int best = -1;
            for (AudioDeviceInfo device : available) {
                int type = device.getType();
                if (isBluetooth(type) && (!bluetoothAllowed(context) || deviceKey(device).equals(blockedBluetooth))) continue;
                int score = isWired(type) ? 300 : isBluetooth(type) ? 200 : type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER ? 100 : type == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE ? 10 : -1;
                if (score > best || score == best && same(device, audio.getCommunicationDevice())) { choice = device; best = score; }
            }
            if (choice == null) { if (!settled) { begin("system", "system"); finish(true); } return; }
            if (same(choice, requested) && (!settled || same(choice, audio.getCommunicationDevice()))) return;
            boolean sameRoute = same(choice, requested);
            requested = choice; failedRoute = false; fallbackPending = false;
            if (sameRoute) settled = false; else begin(kind(choice.getType()), deviceKey(choice));
            handler.removeCallbacks(check);
            if (needsSco()) startSco(); else stopSco();
            if (!audio.setCommunicationDevice(choice)) { audio.clearCommunicationDevice(); if (!audio.setCommunicationDevice(choice)) { fallback(true); return; } }
            deadline = SystemClock.uptimeMillis() + CONNECT_TIMEOUT; check();
        }
        void check() {
            handler.removeCallbacks(check);
            if (!running || settled) return;
            if (same(audio.getCommunicationDevice(), requested) && (!needsSco() || scoConnected)) { finish(failedRoute); return; }
            if (SystemClock.uptimeMillis() >= deadline) {
                if (!fallbackPending) fallback(true);
                else { audio.clearCommunicationDevice(); requested = null; unavailable = true; failedInventory = inventory(audio.getAvailableCommunicationDevices()); begin("system", "system"); finish(true); }
                return;
            }
            handler.postDelayed(check, 250);
        }
        void fallback(boolean failed) {
            handler.removeCallbacks(check);
            stopSco();
            if (requested != null && isBluetooth(requested.getType())) blockedBluetooth = deviceKey(requested);
            audio.clearCommunicationDevice(); requested = null;
            for (AudioDeviceInfo device : audio.getAvailableCommunicationDevices()) if (device.getType() == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) { requested = device; break; }
            failedRoute = failed; fallbackPending = true;
            begin(requested == null ? "system" : "speaker", requested == null ? "system" : deviceKey(requested));
            if (requested != null && audio.setCommunicationDevice(requested)) { deadline = SystemClock.uptimeMillis() + 3000; check(); }
            else { unavailable = true; failedInventory = inventory(audio.getAvailableCommunicationDevices()); begin("system", "system"); finish(failed); }
        }
        String inventory(List<AudioDeviceInfo> available) {
            java.util.TreeSet<String> keys = new java.util.TreeSet<>(); for (AudioDeviceInfo device : available) keys.add(deviceKey(device));
            return keys.toString() + bluetoothAllowed(context);
        }
        boolean same(AudioDeviceInfo a, AudioDeviceInfo b) { return a != null && b != null && a.getId() == b.getId() && a.getType() == b.getType(); }
        String deviceKey(AudioDeviceInfo device) { return device.getType() + ":" + device.getId(); }
    }
}
