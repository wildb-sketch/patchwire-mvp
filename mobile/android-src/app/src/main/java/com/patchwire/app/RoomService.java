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

/** Owns the Android foreground lifetime; WebRTC and its microphone track remain in the WebView. */
public class RoomService extends Service {
    public static final String ACTION_START = "com.patchwire.app.ROOM_START";
    public static final String ACTION_STATE = "com.patchwire.app.ROOM_STATE";
    public static final String ACTION_MUTE = "com.patchwire.app.ROOM_MUTE";
    public static final String ACTION_LEAVE = "com.patchwire.app.ROOM_LEAVE";
    public static final String EXTRA_TITLE = "room_title";
    public static final String EXTRA_MUTED = "muted";
    static final String CHANNEL_ID = "patchwire_room";
    static final int NOTIF_ID = 1001;
    static volatile boolean active = false;
    static volatile boolean microphone = false;

    private AudioManager audio;
    private NotificationManager notifications;
    private AudioFocusRequest focus;
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;
    private boolean muted = true;
    private boolean speaking = false;
    private String title = "Live room";
    private final AudioManager.OnAudioFocusChangeListener focusListener = change -> {
        // A call or another app taking exclusive focus must never leave an unnoticed open microphone.
        if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
            RoomPlugin.command("mute", true);
        }
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
        RoomPlugin.command("leave", true);
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override public void onDestroy() {
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
