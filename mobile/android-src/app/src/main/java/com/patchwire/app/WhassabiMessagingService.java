package com.patchwire.app;

import android.app.PendingIntent;
import android.content.Intent;
import android.net.Uri;
import androidx.core.app.NotificationCompat;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

public class WhassabiMessagingService extends FirebaseMessagingService {
    @Override public void onNewToken(String token) { PushStore.token(this, token); }
    @Override public void onMessageReceived(RemoteMessage message) {
        Map<String, String> data = message.getData();
        String kind = data.get("kind"), target = data.get("target"), uid = data.get("recipient"), binding = data.get("binding"), event = data.get("eventId");
        if (!("message".equals(kind) || "room".equals(kind)) || target == null || event == null || !event.matches("[a-f0-9]{12}") ||
                NavigationTarget.of("message".equals(kind) ? "chat" : "room", target, uid) == null || !PushStore.matches(this, uid, binding)) return;
        if (PushStore.visible || !PushStore.enabled(this)) return;
        Intent intent = new Intent(this, MainActivity.class).setAction("com.patchwire.app.OPEN_PUSH")
            .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .setData(Uri.parse("whassabi-notification://" + kind + "/" + target + "/" + uid))
            .putExtra("kind", "message".equals(kind) ? "chat" : "room").putExtra("target", target).putExtra("recipient", uid).putExtra("binding", binding);
        PendingIntent open = PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        String tag = "whassabi:" + uid + ":" + kind + ":" + target;
        NotificationCompat.Builder notification = new NotificationCompat.Builder(this, PushStore.CHANNEL)
            .setSmallIcon(android.R.drawable.ic_dialog_email).setContentTitle("Whassabi")
            .setCategory(NotificationCompat.CATEGORY_MESSAGE).setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setContentIntent(open).setAutoCancel(true).setOnlyAlertOnce(false)
            .setWhen(System.currentTimeMillis()).setShowWhen(true);
        PushStore.post(this, uid, binding, tag, event, "room".equals(kind), notification);
    }
}
