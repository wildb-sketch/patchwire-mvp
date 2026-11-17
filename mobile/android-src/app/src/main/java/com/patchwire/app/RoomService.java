package com.patchwire.app;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.net.wifi.WifiManager;
import android.os.*;
import androidx.core.app.NotificationCompat;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

/** Owns the Android foreground lifetime; WebRTC and its microphone track remain in the WebView. */
public class RoomService extends Service {
    public static final String ACTION_START = "com.patchwire.app.ROOM_START";
    public static final String ACTION_TRANSPORT_LOST = "com.patchwire.app.ROOM_TRANSPORT_LOST";
    public static final String ACTION_DISMISS = "com.patchwire.app.ROOM_DISMISS";
    public static final String ACTION_STATE = "com.patchwire.app.ROOM_STATE";
    public static final String ACTION_MUTE = "com.patchwire.app.ROOM_MUTE";
    public static final String ACTION_LEAVE = "com.patchwire.app.ROOM_LEAVE";
    public static final String EXTRA_TITLE = "room_title";
    public static final String EXTRA_MUTED = "muted";
    static final String CHANNEL_ID = "patchwire_room";
    static final int NOTIF_ID = 1001;
    static volatile boolean active = false;
    static volatile boolean microphone = false;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private String serverUrl = "", token = "", roomId = "", leaveToken = "";
    private boolean dismissing = false;
    private int sessionGeneration = 0;

    static void dismiss(Context context) {
        if (!active) return;
        try { context.startService(new Intent(context, RoomService.class).setAction(ACTION_DISMISS)); }
        catch (RuntimeException ignored) { /* Service already stopped: use server disconnect grace. */ }
    }

    static void transportLost(Context context) {
        if (!active) return;
        try { context.startService(new Intent(context, RoomService.class).setAction(ACTION_TRANSPORT_LOST)); }
        catch (RuntimeException ignored) { /* Already stopped. */ }
    }

    private AudioManager audio;
    private NotificationManager notifications;
    private AudioFocusRequest focus;
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;
    private boolean muted = true;
    private boolean speaking = false;
    private String title = "Live room";
    private final AudioManager.OnAudioFocusChangeListener focusListener = change -> {
        // Audio focus controls playback arbitration, not the user's microphone choice.
        // Media apps can take focus without taking microphone ownership. Android itself
        // enforces microphone privacy/silencing for calls and competing recorders.
        android.util.Log.i("WhassabiRoom", "Audio focus=" + change + "; microphone intent unchanged");
    };

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public void onCreate() {
        super.onCreate();
        audio = (AudioManager) getSystemService(AUDIO_SERVICE);
        notifications = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Live room", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Voice room audio and controls");
            channel.setShowBadge(false);
            notifications.createNotificationChannel(channel);
        }
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        // The WebView cannot recover its transport after process death. Do not resurrect a fake call.
        if (intent == null) { stopSelf(); return START_NOT_STICKY; }
        String action = intent.getAction();
        if (ACTION_TRANSPORT_LOST.equals(action)) {
            // A task-removal leave may already be in flight. Do not cancel its native request.
            if (!dismissing) stopSelf();
            return START_NOT_STICKY;
        }
        if (ACTION_DISMISS.equals(action)) { leaveNatively(); return START_NOT_STICKY; }
        if (ACTION_MUTE.equals(action) || ACTION_LEAVE.equals(action)) {
            if (!active || !RoomPlugin.command(ACTION_LEAVE.equals(action) ? "leave" : "mute",
                    intent.getBooleanExtra(EXTRA_MUTED, true))) stopSelf();
            return START_NOT_STICKY;
        }
        if (ACTION_STATE.equals(action)) {
            if (!active) { stopSelf(); return START_NOT_STICKY; }
            muted = intent.getBooleanExtra(EXTRA_MUTED, true);
            speaking = intent.getBooleanExtra("speaking", false);
            notifications.notify(NOTIF_ID, notification());
            return START_NOT_STICKY;
        }
        if (!ACTION_START.equals(action)) { stopSelf(); return START_NOT_STICKY; }
        ResultReceiver receiver = intent.getParcelableExtra("receiver");
        try {
            String nextLeaveToken = intent.getStringExtra("leaveToken");
            if (!leaveToken.equals(nextLeaveToken)) {
                sessionGeneration++;
                dismissing = false;
            } else if (dismissing) throw new IllegalStateException("Room is closing");
            serverUrl = intent.getStringExtra("serverUrl");
            token = intent.getStringExtra("token");
            roomId = intent.getStringExtra("roomId");
            leaveToken = nextLeaveToken == null ? "" : nextLeaveToken;
            title = intent.getStringExtra(EXTRA_TITLE);
            muted = intent.getBooleanExtra(EXTRA_MUTED, true);
            speaking = intent.getBooleanExtra("speaking", false);
            boolean needsMic = intent.getBooleanExtra("microphone", false);
            // Once granted in the foreground, retain microphone eligibility through mute/demotion.
            microphone = microphone || needsMic;
            if (Build.VERSION.SDK_INT >= 29) {
                int types = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK;
                if (microphone && Build.VERSION.SDK_INT >= 30) types |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
                startForeground(NOTIF_ID, notification(), types);
            } else startForeground(NOTIF_ID, notification());
            if (!active) acquireResources();
            active = true;
            if (receiver != null) receiver.send(0, Bundle.EMPTY);
        } catch (RuntimeException e) {
            Bundle error = new Bundle(); error.putString("error", "Room audio service: " + e.getMessage());
            if (receiver != null) receiver.send(1, error);
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    private void acquireResources() {
        wakeLock = ((PowerManager) getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Whassabi:VoiceRoom");
        wakeLock.setReferenceCounted(false);
        wakeLock.acquire(); // Lifetime is strictly bounded by the joined room / onDestroy.
        WifiManager wifi = (WifiManager) getApplicationContext().getSystemService(WIFI_SERVICE);
        if (wifi != null) {
            wifiLock = wifi.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "Whassabi:VoiceRoom");
            wifiLock.setReferenceCounted(false);
            wifiLock.acquire();
        }
        if (Build.VERSION.SDK_INT >= 26) {
            focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                .setOnAudioFocusChangeListener(focusListener).build();
            audio.requestAudioFocus(focus);
        } else audio.requestAudioFocus(focusListener, AudioManager.STREAM_VOICE_CALL, AudioManager.AUDIOFOCUS_GAIN);
    }

    @Override public void onTaskRemoved(Intent rootIntent) {
        // Android can destroy the WebView before delivering its last JavaScript event.
        leaveNatively();
        super.onTaskRemoved(rootIntent);
    }

    private void leaveNatively() {
        if (dismissing) return;
        dismissing = true;
        if (!active || serverUrl == null || token == null || roomId == null || leaveToken.isEmpty()) {
            stopSelf();
            return;
        }
        final int generation = sessionGeneration;
        final String endpoint = serverUrl + "/api/room/leave", auth = token, id = roomId, lease = leaveToken;
        Runnable finish = () -> {
            // A rapid reopen has a new lease: its room and service must survive this old request.
            if (generation == sessionGeneration && dismissing) stopSelf();
        };
        handler.postDelayed(finish, 7000);
        new Thread(() -> {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(endpoint).openConnection();
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(2500);
                connection.setReadTimeout(2500);
                connection.setRequestMethod("POST");
                connection.setRequestProperty("Authorization", "Bearer " + auth);
                connection.setRequestProperty("Content-Type", "application/json");
                connection.setDoOutput(true);
                byte[] body = new JSONObject().put("roomId", id).put("leaveToken", lease)
                    .toString().getBytes(StandardCharsets.UTF_8);
                connection.setFixedLengthStreamingMode(body.length);
                try (java.io.OutputStream output = connection.getOutputStream()) { output.write(body); }
                connection.getResponseCode();
            } catch (Exception ignored) {
                // Offline or force-killed devices still use the server's normal disconnect grace.
            } finally {
                if (connection != null) connection.disconnect();
                handler.post(finish);
            }
        }, "Whassabi-RoomLeave").start();
    }

    @Override public void onDestroy() {
        sessionGeneration++;
        handler.removeCallbacksAndMessages(null);
        token = ""; leaveToken = "";
        active = false;
        microphone = false;
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
        if (Build.VERSION.SDK_INT >= 26 && focus != null) audio.abandonAudioFocusRequest(focus);
        else if (audio != null) audio.abandonAudioFocus(focusListener);
        stopForeground(true);
        super.onDestroy();
    }

    private Notification notification() {
        int flags = PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT;
        PendingIntent open = PendingIntent.getActivity(this, 0,
            new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP), flags);
        PendingIntent leave = PendingIntent.getService(this, 1,
            new Intent(this, RoomService.class).setAction(ACTION_LEAVE), flags);
        PendingIntent toggle = PendingIntent.getService(this, 2,
            new Intent(this, RoomService.class).setAction(ACTION_MUTE).putExtra(EXTRA_MUTED, !muted), flags);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle(title).setContentText(!speaking ? "Listening — tap to return" : muted ? "Microphone muted" : "Microphone on")
            .setContentIntent(open).setOngoing(true).setSilent(true).setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_CALL).setVisibility(NotificationCompat.VISIBILITY_PUBLIC);
        if (speaking) builder.addAction(android.R.drawable.ic_btn_speak_now, muted ? "Unmute" : "Mute", toggle);
        return builder.addAction(android.R.drawable.ic_delete, "Leave", leave).build();
    }
}
