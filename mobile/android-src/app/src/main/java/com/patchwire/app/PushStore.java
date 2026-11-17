package com.patchwire.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.NotificationCompat;
import org.json.JSONObject;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

final class PushStore {
    static final String CHANNEL = "whassabi_social";
    static final int NOTIFICATION = 2001;
    static volatile boolean visible;
    private static final ExecutorService IO = Executors.newSingleThreadExecutor();
    static SharedPreferences prefs(Context c) { return c.getSharedPreferences("whassabi_push", Context.MODE_PRIVATE); }
    static void channel(Context c) {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, "Messages and invitations", NotificationManager.IMPORTANCE_DEFAULT);
            channel.setDescription("Private messages and room invitations");
            c.getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }
    }
    static boolean enabled(Context c) {
        channel(c);
        if (!NotificationManagerCompat.from(c).areNotificationsEnabled()) return false;
        if (Build.VERSION.SDK_INT >= 26) return c.getSystemService(NotificationManager.class).getNotificationChannel(CHANNEL).getImportance() != NotificationManager.IMPORTANCE_NONE;
        return true;
    }
    static synchronized String deviceId(Context c) {
        SharedPreferences p = prefs(c);
        String id = p.getString("deviceId", "");
        if (id.isEmpty()) { id = UUID.randomUUID().toString().replace("-", ""); p.edit().putString("deviceId", id).apply(); }
        return id;
    }
    static synchronized boolean configure(Context c, String origin, String uid, String id, String key, String binding) {
        if (!id.equals(deviceId(c))) return false;
        SharedPreferences p = prefs(c);
        // Rechecking a token in the background must not dismiss notifications or reset deduplication.
        if (!uid.equals(p.getString("uid", "")) || !binding.equals(p.getString("binding", ""))) {
            cancel(c);
            p.edit().remove("seen").remove("counts").apply();
        }
        prefs(c).edit().putString("origin", origin).putString("uid", uid).putString("deviceId", id)
            .putString("key", key).putString("binding", binding).apply();
        return true;
    }
    static synchronized boolean matches(Context c, String uid, String binding) {
        SharedPreferences p = prefs(c);
        return uid != null && !uid.isEmpty() && uid.equals(p.getString("uid", "")) && binding != null && !binding.isEmpty() && binding.equals(p.getString("binding", ""));
    }
    private static boolean seen(Context c, String id) {
        return ("," + prefs(c).getString("seen", "") + ",").contains("," + id + ",");
    }
    private static void rememberEvent(Context c, String id) {
        SharedPreferences p = prefs(c);
        String old = p.getString("seen", "");
        String next = old.isEmpty() ? id : old + "," + id;
        String[] values = next.split(",");
        if (values.length > 64) next = next.substring(next.indexOf(',') + 1);
        p.edit().putString("seen", next).apply();
    }
    static synchronized void remember(Context c, String tag) {
        SharedPreferences p = prefs(c);
        Set<String> tags = new HashSet<>(p.getStringSet("tags", new HashSet<>()));
        tags.add(tag); p.edit().putStringSet("tags", tags).apply();
    }
    static synchronized void post(Context c, String uid, String binding, String tag, String event, boolean room, NotificationCompat.Builder notification) {
        if (!matches(c, uid, binding) || visible || !enabled(c)) return;
        if (seen(c, event)) return;
        SharedPreferences p = prefs(c);
        JSONObject counts;
        try { counts = new JSONObject(p.getString("counts", "{}")); }
        catch (Exception ignored) { counts = new JSONObject(); }
        int count = Math.min(999, counts.optInt(tag, 0) + 1);
        notification.setNumber(count).setContentText(room ? (count == 1 ? "You have a room invitation" : "You have " + count + " room invitations") :
            (count == 1 ? "You have a new private message" : "You have " + count + " new private messages"));
        try {
            NotificationManagerCompat.from(c).notify(tag, NOTIFICATION, notification.build());
            remember(c, tag); rememberEvent(c, event);
            counts.put(tag, count); p.edit().putString("counts", counts.toString()).apply();
        }
        catch (SecurityException ignored) { /* Permission changes cannot interrupt voice. */ }
        catch (org.json.JSONException ignored) { /* Posting must never depend on counter persistence. */ }
    }
    static synchronized void opened(Context c) {
        visible = true;
        cancel(c);
        prefs(c).edit().remove("counts").apply();
    }
    private static void cancel(Context c) {
        SharedPreferences p = prefs(c);
        NotificationManager manager = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        for (String tag : p.getStringSet("tags", new HashSet<>())) manager.cancel(tag, NOTIFICATION);
        p.edit().remove("tags").apply();
    }
    static synchronized void clear(Context c) {
        JSONObject old = snapshot(c, true);
        cancel(c);
        String token = prefs(c).getString("token", "");
        prefs(c).edit().clear().putString("token", token).apply();
        if (old != null) IO.execute(() -> transmit(old));
    }
    static synchronized void token(Context c, String token) {
        prefs(c).edit().putString("token", token).apply();
        JSONObject update = snapshot(c, false);
        if (update != null) IO.execute(() -> transmit(update));
        PushPlugin.changed();
    }
    private static JSONObject snapshot(Context c, boolean remove) {
        SharedPreferences p = prefs(c);
        if (p.getString("key", "").isEmpty()) return null;
        JSONObject result = new JSONObject();
        try { result.put("origin", p.getString("origin", "")).put("deviceId", p.getString("deviceId", ""))
            .put("deviceKey", p.getString("key", "")).put("token", p.getString("token", "")).put("remove", remove); }
        catch (Exception ignored) { return null; }
        return result;
    }
    private static void transmit(JSONObject data) {
        HttpURLConnection connection = null;
        try {
            String origin = data.getString("origin"); data.remove("origin");
            connection = (HttpURLConnection) new URL(origin + "/api/push/refresh").openConnection();
            connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(4000); connection.setReadTimeout(4000);
            connection.setRequestMethod("POST"); connection.setRequestProperty("Content-Type", "application/json"); connection.setDoOutput(true);
            byte[] bytes = data.toString().getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(bytes.length);
            try (java.io.OutputStream out = connection.getOutputStream()) { out.write(bytes); }
            connection.getResponseCode();
        } catch (Exception ignored) { /* The next foreground registration retries without blocking voice. */ }
        finally { if (connection != null) connection.disconnect(); }
    }
}
