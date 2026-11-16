package com.patchwire.app;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.ResultReceiver;
import androidx.core.app.NotificationManagerCompat;
import androidx.lifecycle.Lifecycle;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.lang.ref.WeakReference;

@CapacitorPlugin(name = "RoomPlugin", permissions = {
    @Permission(alias = "microphone", strings = {Manifest.permission.RECORD_AUDIO}),
    @Permission(alias = "notifications", strings = {"android.permission.POST_NOTIFICATIONS"})
})
public class RoomPlugin extends Plugin {
    private boolean notificationAsked = false;
    private boolean destroyed = false;
    private static WeakReference<RoomPlugin> current = new WeakReference<>(null);

    @Override public void load() { current = new WeakReference<>(this); }

    static boolean command(String action, boolean muted) {
        RoomPlugin plugin = current.get();
        if (plugin == null || !plugin.hasListeners("roomAction")) return false;
        JSObject data = new JSObject();
        data.put("action", action);
        data.put("muted", muted);
        plugin.notifyListeners("roomAction", data);
        return true;
    }

    private boolean visible() {
        return getActivity().getLifecycle().getCurrentState().isAtLeast(Lifecycle.State.RESUMED);
    }

    @PluginMethod public void prepareMicrophone(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (getPermissionState("microphone") == PermissionState.GRANTED) call.resolve();
            else if (!visible()) call.reject("Open Whassabi to allow microphone access.", "APP_BACKGROUND");
            else requestPermissionForAlias("microphone", call, "microphoneResult");
        });
    }

    @PermissionCallback private void microphoneResult(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) call.resolve();
        else call.reject("Microphone access denied. Allow Microphone in Android Settings > Apps > Whassabi > Permissions.", "MIC_PERMISSION_DENIED");
    }

    @PluginMethod public void startRoom(PluginCall call) {
        getActivity().runOnUiThread(() -> startWhenReady(call, 0));
    }

    private void startWhenReady(PluginCall call, int attempt) {
        if (destroyed) { call.reject("Room activity was closed.", "ACTIVITY_CLOSED"); return; }
        boolean microphone = Boolean.TRUE.equals(call.getBoolean("microphone", false));
        if ((!RoomService.active || (microphone && !RoomService.microphone)) && !visible()) {
            // Permission results can arrive just before Activity.onResume. Wait for that transition,
            // but never try to create a microphone FGS while the app remains in the background.
            if (attempt < 40 && !getActivity().isFinishing()) {
                new Handler(Looper.getMainLooper()).postDelayed(() -> startWhenReady(call, attempt + 1), 50);
            } else call.reject("Return to Whassabi to start room audio.", "APP_BACKGROUND");
            return;
        }
        if (microphone && getPermissionState("microphone") != PermissionState.GRANTED) {
            call.reject("Allow microphone access before starting room audio.", "MIC_PERMISSION_DENIED");
            return;
        }
        if (Build.VERSION.SDK_INT >= 33 && visible() && !notificationAsked &&
            getPermissionState("notifications") == PermissionState.PROMPT) {
            notificationAsked = true;
            requestPermissionForAlias("notifications", call, "notificationResult");
        } else startService(call);
    }

    @PermissionCallback private void notificationResult(PluginCall call) {
        // Denial must not deny voice. Wait for Activity resume before starting the FGS.
        startWhenReady(call, 0);
    }

    private void startService(PluginCall call) {
        // Only send the in-memory session to the HTTPS origin currently hosting this WebView.
        Uri origin = Uri.parse(call.getString("serverUrl", ""));
        Uri page = Uri.parse(getBridge().getWebView().getUrl());
        if (!"https".equals(origin.getScheme()) || origin.getAuthority() == null || origin.getUserInfo() != null ||
            !origin.getScheme().equals(page.getScheme()) || !origin.getAuthority().equals(page.getAuthority()) ||
            origin.getQuery() != null || origin.getFragment() != null ||
            !(origin.getPath() == null || origin.getPath().isEmpty() || "/".equals(origin.getPath()))) {
            call.reject("Room server does not match the app page.", "INVALID_ROOM_SERVER");
            return;
        }
        Handler handler = new Handler(Looper.getMainLooper());
        final boolean[] finished = {false};
        Runnable timeout = () -> {
            if (finished[0]) return;
            finished[0] = true;
            getContext().stopService(new Intent(getContext(), RoomService.class));
            call.reject("Room audio service did not start. Return to the app and try again.", "SERVICE_TIMEOUT");
        };
        ResultReceiver receiver = new ResultReceiver(handler) {
            @Override protected void onReceiveResult(int result, Bundle data) {
                if (finished[0]) return;
                finished[0] = true;
                handler.removeCallbacks(timeout);
                if (result != 0) call.reject(data.getString("error", "Room audio service failed"), "SERVICE_START_FAILED");
                else {
                    JSObject status = new JSObject();
                    boolean notificationsEnabled = NotificationManagerCompat.from(getContext()).areNotificationsEnabled();
                    if (Build.VERSION.SDK_INT >= 26) {
                        NotificationChannel channel = getContext().getSystemService(NotificationManager.class)
                            .getNotificationChannel(RoomService.CHANNEL_ID);
                        notificationsEnabled = notificationsEnabled && channel != null &&
                            channel.getImportance() != NotificationManager.IMPORTANCE_NONE;
                    }
                    status.put("notificationsEnabled", notificationsEnabled);
                    call.resolve(status);
                }
            }
        };
        Intent intent = new Intent(getContext(), RoomService.class).setAction(RoomService.ACTION_START)
            .putExtra(RoomService.EXTRA_TITLE, call.getString("title", "Live room"))
            .putExtra("speaking", Boolean.TRUE.equals(call.getBoolean("speaking", false)))
            .putExtra("microphone", Boolean.TRUE.equals(call.getBoolean("microphone", false)))
            .putExtra(RoomService.EXTRA_MUTED, Boolean.TRUE.equals(call.getBoolean("muted", true)))
            .putExtra("receiver", receiver)
            .putExtra("serverUrl", origin.toString())
            .putExtra("token", call.getString("token", ""))
            .putExtra("roomId", call.getString("roomId", ""))
            .putExtra("leaveToken", call.getString("leaveToken", ""));
        try {
            handler.postDelayed(timeout, 8000);
            if (Build.VERSION.SDK_INT >= 26 && !RoomService.active) getContext().startForegroundService(intent);
            else getContext().startService(intent);
        } catch (RuntimeException e) {
            finished[0] = true;
            handler.removeCallbacks(timeout);
            call.reject("Could not start room audio: " + e.getMessage(), "SERVICE_START_FAILED", e);
        }
    }

    @PluginMethod public void dismissRoom(PluginCall call) {
        RoomService.dismiss(getContext());
        call.resolve();
    }

    @PluginMethod public void stopRoom(PluginCall call) {
        getContext().stopService(new Intent(getContext(), RoomService.class));
        call.resolve();
    }

    @PluginMethod public void setMuted(PluginCall call) {
        if (RoomService.active) {
            getContext().startService(new Intent(getContext(), RoomService.class).setAction(RoomService.ACTION_STATE)
                .putExtra("speaking", Boolean.TRUE.equals(call.getBoolean("speaking", false)))
                .putExtra(RoomService.EXTRA_MUTED, Boolean.TRUE.equals(call.getBoolean("muted", true))));
        }
        call.resolve();
    }

    @Override protected void handleOnDestroy() {
        destroyed = true;
        if (current.get() == this) {
            current.clear();
            // A replaced Activity must not dismiss the new Activity's room service.
            // The service, not the destroyed WebView, performs the final membership request.
            RoomService.dismiss(getContext());
        }
    }
}
