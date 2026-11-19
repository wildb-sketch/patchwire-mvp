package com.patchwire.app;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothClass;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothProfile;
import android.content.Context;
import android.media.AudioDeviceInfo;
import android.os.Handler;
import android.os.Looper;
import java.util.ArrayList;
import java.util.List;
import java.util.TreeSet;

/** Actual connected HFP devices, independent of AudioManager's routable/stale port list. */
@android.annotation.TargetApi(31)
@android.annotation.SuppressLint("MissingPermission") // Every query checks BLUETOOTH_CONNECT.
final class RoomBluetoothDevices {
    private final Context context;
    private final Handler handler;
    private final Runnable changed;
    private BluetoothAdapter adapter;
    private BluetoothProfile profile;
    private boolean running, known, binding, serviceConnected;
    private String inventory = "";
    private final List<Entry> connected = new ArrayList<>();
    private static final class Entry {
        final String address; final boolean watch;
        Entry(BluetoothDevice device) {
            address = normalize(device.getAddress()); BluetoothClass type = device.getBluetoothClass();
            watch = type != null && type.getMajorDeviceClass() == BluetoothClass.Device.Major.WEARABLE;
        }
    }
    private final BluetoothProfile.ServiceListener listener = new BluetoothProfile.ServiceListener() {
        @Override public void onServiceConnected(int id, BluetoothProfile proxy) {
            dispatch(() -> { if (!running) { close(proxy); return; } profile = proxy; serviceConnected = true; refresh(); });
        }
        @Override public void onServiceDisconnected(int id) { dispatch(() -> { serviceConnected = false; update(new ArrayList<>()); }); }
    };
    RoomBluetoothDevices(Context context, Handler handler, Runnable changed) { this.context = context; this.handler = new Handler(handler.getLooper()); this.changed = changed; }
    void start() {
        running = true; bind();
    }
    private void bind() {
        try {
            if (!RoomAudioRoute.bluetoothAllowed(context)) { update(new ArrayList<>()); return; }
            adapter = BluetoothAdapter.getDefaultAdapter();
            if (adapter == null || !adapter.isEnabled()) { update(new ArrayList<>()); return; }
            binding = true;
            if (!adapter.getProfileProxy(context, listener, BluetoothProfile.HEADSET)) { binding = false; update(new ArrayList<>()); }
        } catch (RuntimeException ignored) { binding = false; update(new ArrayList<>()); }
    }
    void refresh() {
        if (!running) return;
        if (!binding && profile == null && RoomAudioRoute.bluetoothAllowed(context)) bind();
        List<Entry> result = new ArrayList<>();
        try { if (profile != null && serviceConnected && RoomAudioRoute.bluetoothAllowed(context)) for (BluetoothDevice device : profile.getConnectedDevices()) result.add(new Entry(device)); }
        catch (RuntimeException ignored) { result.clear(); }
        update(result);
    }
    private void update(List<Entry> result) {
        if (!running) return;
        TreeSet<String> keys = new TreeSet<>(); for (Entry entry : result) keys.add(entry.address + ":" + entry.watch);
        String next = keys.toString(); boolean different = !known || !next.equals(inventory);
        known = true; inventory = next; connected.clear(); connected.addAll(result);
        if (different) changed.run();
    }
    boolean permits(AudioDeviceInfo device, boolean includeWatches) {
        if (!known) return false;
        String address = normalize(device.getAddress());
        boolean identified = address.matches("[0-9a-f]{12}") && !address.equals("000000000000") && !address.equals("020000000000");
        for (Entry entry : connected) if ((!identified || address.equals(entry.address)) && (includeWatches || !entry.watch)) return true;
        return false;
    }
    void stop() { running = false; if (profile != null) close(profile); profile = null; connected.clear(); }
    private void close(BluetoothProfile proxy) { try { if (adapter != null) adapter.closeProfileProxy(BluetoothProfile.HEADSET, proxy); } catch (RuntimeException ignored) {} }
    private void dispatch(Runnable work) { if (Looper.myLooper() == handler.getLooper()) work.run(); else handler.post(work); }
    static String normalize(String address) { return address == null ? "" : address.replace(":", "").replace("-", "").toLowerCase(java.util.Locale.ROOT); }
}
