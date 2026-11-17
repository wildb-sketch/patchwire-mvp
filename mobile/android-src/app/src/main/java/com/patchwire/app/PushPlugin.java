package com.patchwire.app;

import android.net.Uri;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.firebase.messaging.FirebaseMessaging;
import java.lang.ref.WeakReference;

@CapacitorPlugin(name = "PushPlugin")
public class PushPlugin extends Plugin {
    private static WeakReference<PushPlugin> current = new WeakReference<>(null);
    @Override public void load() { current = new WeakReference<>(this); PushStore.channel(getContext()); }
    static void changed() { PushPlugin plugin = current.get(); if (plugin != null) plugin.notifyListeners("registrationChanged", new JSObject()); }
    private boolean origin(String origin) {
        Uri uri = Uri.parse(origin), page = Uri.parse(getBridge().getWebView().getUrl());
        return "https".equals(uri.getScheme()) && uri.getUserInfo() == null && uri.getAuthority() != null &&
            uri.getAuthority().equals(page.getAuthority()) && uri.getScheme().equals(page.getScheme()) && uri.getQuery() == null && uri.getFragment() == null &&
            (uri.getPath() == null || uri.getPath().isEmpty() || "/".equals(uri.getPath()));
    }
    @PluginMethod public void getState(PluginCall call) {
        getActivity().runOnUiThread(() -> readState(call));
    }
    private void readState(PluginCall call) {
        if (!PushStore.enabled(getContext())) { JSObject result = new JSObject(); result.put("enabled", false); call.resolve(result); return; }
        try {
            FirebaseMessaging.getInstance().setAutoInitEnabled(true);
            FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
                if (!task.isSuccessful()) { call.reject("Push registration unavailable", "PUSH_UNAVAILABLE"); return; }
                String token = task.getResult();
                // Saving an unchanged token must not produce a registration event loop.
                if (!token.equals(PushStore.prefs(getContext()).getString("token", ""))) PushStore.token(getContext(), token);
                JSObject result = new JSObject(); result.put("enabled", true); result.put("deviceId", PushStore.deviceId(getContext())); result.put("token", token);
                result.put("uid", PushStore.prefs(getContext()).getString("uid", ""));
                if (call.getString("uid", "").equals(PushStore.prefs(getContext()).getString("uid", "")) && origin(call.getString("origin", ""))) {
                    result.put("deviceKey", PushStore.prefs(getContext()).getString("key", ""));
                }
                call.resolve(result);
            });
        } catch (RuntimeException ignored) { call.reject("Push registration unavailable", "PUSH_UNAVAILABLE"); }
    }
    @PluginMethod public void configure(PluginCall call) {
        getActivity().runOnUiThread(() -> configureOnUiThread(call));
    }
    private void configureOnUiThread(PluginCall call) {
        String server = call.getString("origin", ""), uid = call.getString("uid", ""), id = call.getString("deviceId", ""), key = call.getString("deviceKey", ""), binding = call.getString("binding", "");
        if (!origin(server) || !uid.matches("[a-f0-9]{12}") || !id.equals(PushStore.deviceId(getContext())) || !key.matches("[A-Za-z0-9_-]{43}") || !binding.matches("[A-Za-z0-9_-]{22}")) {
            call.reject("Invalid push registration", "INVALID_PUSH_REGISTRATION"); return;
        }
        if (!PushStore.configure(getContext(), server, uid, id, key, binding)) {
            call.reject("Push registration changed", "INVALID_PUSH_REGISTRATION"); return;
        }
        call.resolve();
    }
    @PluginMethod public void clear(PluginCall call) { PushStore.clear(getContext()); call.resolve(); }
    @Override protected void handleOnDestroy() { if (current.get() == this) current.clear(); }
}
