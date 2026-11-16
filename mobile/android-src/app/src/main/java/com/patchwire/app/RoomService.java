package com.patchwire.app;

import android.app.*;
import android.content.*;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.*;
import androidx.core.app.NotificationCompat;

/**
 * Foreground service that keeps the microphone and WebRTC audio alive when the screen
 * turns off or the user switches apps. Exposes Mute and Leave buttons in the notification.
 */
public class RoomService extends Service {

    public static final String ACTION_START = "com.patchwire.app.ROOM_START";
    public static final String ACTION_STOP  = "com.patchwire.app.ROOM_STOP";
    public static final String ACTION_MUTE  = "com.patchwire.app.ROOM_MUTE";
    public static final String EXTRA_TITLE  = "room_title";
    public static final String EXTRA_MUTED  = "muted";
    static final String CHANNEL_ID          = "patchwire_room";
    static final int    NOTIF_ID            = 1001;

    private AudioManager      am;
    private AudioFocusRequest afr;
    private boolean           muted    = false;
    private String            lastTitle = "Live room";

    @Override public IBinder onBind(Intent i) { return null; }

    @Override
    public void onCreate() {
        super.onCreate();
        am = (AudioManager) getSystemService(AUDIO_SERVICE);
        createChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_STICKY;
        final String action = intent.getAction();
        if (ACTION_STOP.equals(action)) { stopSelf(); return START_NOT_STICKY; }
        if (ACTION_MUTE.equals(action)) {
            muted = intent.getBooleanExtra(EXTRA_MUTED, false);
            updateNotif(lastTitle);
            return START_STICKY;
        }
        // ACTION_START
        String t = intent.getStringExtra(EXTRA_TITLE);
        if (t != null) lastTitle = t;
        requestAudioFocus();
        startForeground(NOTIF_ID, buildNotif(lastTitle));
        return START_STICKY;
    }

    @Override
    public void onDestroy() { abandonAudioFocus(); super.onDestroy(); }

    // ---- audio focus ----
    private void requestAudioFocus() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            AudioAttributes attrs = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build();
            afr = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                    .setAudioAttributes(attrs)
                    .setOnAudioFocusChangeListener(change -> {}).build();
            am.requestAudioFocus(afr);
        }
    }
    private void abandonAudioFocus() {
        if (afr != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) am.abandonAudioFocusRequest(afr);
    }

    // ---- notification ----
    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "Live room", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("Keeps your voice room running in the background");
        ch.setShowBadge(false);
        ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(ch);
    }

    private Notification buildNotif(String title) {
        Intent open   = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        Intent stop   = new Intent(this, RoomService.class).setAction(ACTION_STOP);
        Intent toggle = new Intent(this, RoomService.class).setAction(ACTION_MUTE).putExtra(EXTRA_MUTED, !muted);
        PendingIntent piOpen   = PendingIntent.getActivity(this, 0, open,   PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent piStop   = PendingIntent.getService(this,  1, stop,   PendingIntent.FLAG_IMMUTABLE);
        PendingIntent piToggle = PendingIntent.getService(this,  2, toggle, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentTitle(title)
                .setContentText(muted ? "Microphone muted — tap to return" : "You are live — tap to return")
                .setContentIntent(piOpen).setOngoing(true).setSilent(true)
                .addAction(muted ? android.R.drawable.ic_btn_speak_now : android.R.drawable.ic_lock_silent_mode,
                           muted ? "Unmute" : "Mute", piToggle)
                .addAction(android.R.drawable.ic_delete, "Leave", piStop)
                .build();
    }
    private void updateNotif(String title) {
        ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify(NOTIF_ID, buildNotif(title));
    }
}
