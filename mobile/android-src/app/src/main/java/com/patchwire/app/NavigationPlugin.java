package com.patchwire.app;

import android.content.Context;
import android.content.SharedPreferences;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.lang.ref.WeakReference;
import java.util.UUID;

@CapacitorPlugin(name = "NavigationPlugin")
public class NavigationPlugin extends Plugin {
    private static WeakReference<NavigationPlugin> current = new WeakReference<>(null);
    private static SharedPreferences prefs(Context context) { return context.getSharedPreferences("whassabi_navigation", Context.MODE_PRIVATE); }
    static void enqueue(Context context, NavigationTarget target) {
        if (target == null) return;
        String id = UUID.randomUUID().toString();
        prefs(context).edit().putString("id", id).putString("kind", target.kind).putString("target", target.target)
            .putString("recipient", target.recipient).putLong("time", System.currentTimeMillis()).apply();
        NavigationPlugin plugin = current.get();
        if (plugin != null) plugin.notifyListeners("navigation", read(context));
    }
    private static JSObject read(Context context) {
        SharedPreferences p = prefs(context);
        JSObject result = new JSObject();
        if (System.currentTimeMillis() - p.getLong("time", 0) > 86400000) return result;
        for (String key : new String[] {"id", "kind", "target", "recipient"}) result.put(key, p.getString(key, ""));
        result.put("time", p.getLong("time", 0));
        return result;
    }
    @Override public void load() { current = new WeakReference<>(this); }
    @PluginMethod public void getPending(PluginCall call) { call.resolve(read(getContext())); }
    @PluginMethod public void consume(PluginCall call) {
        SharedPreferences p = prefs(getContext());
        if (p.getString("id", "").equals(call.getString("id", ""))) p.edit().clear().apply();
        call.resolve();
    }
    @Override protected void handleOnDestroy() { if (current.get() == this) current.clear(); }
}
