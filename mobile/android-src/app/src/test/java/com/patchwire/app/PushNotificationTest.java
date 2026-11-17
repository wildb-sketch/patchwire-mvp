package com.patchwire.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.service.notification.StatusBarNotification;
import androidx.core.app.NotificationCompat;
import com.google.firebase.messaging.RemoteMessage;
import java.util.HashMap;
import java.util.Map;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28, manifest = Config.NONE)
public class PushNotificationTest {
    private static final String UID = "aaaaaaaaaaaa", PEER = "bbbbbbbbbbbb", BINDING = "fixture-binding";
    private Context context;
    private NotificationManager manager;
    private WhassabiMessagingService service;

    @Before public void setup() {
        context = RuntimeEnvironment.getApplication();
        PushStore.prefs(context).edit().clear().commit();
        PushStore.visible = false;
        manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        manager.cancelAll(); Shadows.shadowOf(manager).setNotificationsEnabled(true);
        PushStore.channel(context);
        bind(UID, BINDING);
        service = Robolectric.buildService(WhassabiMessagingService.class).create().get();
    }
    @After public void teardown() { service.onDestroy(); PushStore.visible = false; }

    private void bind(String uid, String binding) {
        // No refresh capability is installed: notification tests must never make network requests.
        assertTrue(PushStore.configure(context, "https://fixture.invalid", uid, PushStore.deviceId(context), "", binding));
    }
    private void receive(int event) { receive(event, UID, BINDING); }
    private void receive(int event, String uid, String binding) {
        Map<String, String> data = new HashMap<>();
        data.put("kind", "message"); data.put("target", PEER);
        data.put("recipient", uid); data.put("binding", binding);
        data.put("eventId", String.format("%012x", event));
        service.onMessageReceived(new RemoteMessage.Builder("fixture").setMessageId("transport-" + event).setData(data).build());
    }
    private StatusBarNotification social() {
        for (StatusBarNotification entry : manager.getActiveNotifications()) if (entry.getId() == PushStore.NOTIFICATION) return entry;
        return null;
    }

    @Test public void everyNewMessageUpdatesAndAlertsWithoutStackingCards() {
        receive(1);
        assertEquals("You have a new private message", social().getNotification().extras.getString(Notification.EXTRA_TEXT));
        String tag = social().getTag();
        for (int event = 2; event <= 3; event++) {
            receive(event);
            assertEquals(1, manager.getActiveNotifications().length);
            Notification notification = social().getNotification();
            assertEquals(tag, social().getTag());
            assertEquals(event, notification.number);
            assertEquals("You have " + event + " new private messages", notification.extras.getString(Notification.EXTRA_TEXT));
            assertEquals(0, notification.flags & Notification.FLAG_ONLY_ALERT_ONCE);
            assertEquals(NotificationManager.IMPORTANCE_DEFAULT, manager.getNotificationChannel(PushStore.CHANNEL).getImportance());
        }
    }
    @Test public void dismissalDoesNotSuppressTheNextMessageAndDuplicateDeliveryDoesNotAlertAgain() {
        receive(1); String tag = social().getTag();
        manager.cancel(tag, PushStore.NOTIFICATION); assertNull(social());
        receive(1); assertNull(social());
        receive(2); assertNotNull(social()); assertEquals(2, social().getNotification().number);
        receive(2); assertEquals(2, social().getNotification().number);
        manager.cancel(tag, PushStore.NOTIFICATION);
        receive(3); assertNotNull(social()); assertEquals(3, social().getNotification().number);
    }
    @Test public void backgroundTokenChecksPreserveNotificationsCountsAndDuplicateProtection() {
        receive(1); bind(UID, BINDING);
        assertNotNull(social());
        receive(1); assertEquals(1, social().getNotification().number);
        receive(2); assertEquals(2, social().getNotification().number);
    }
    @Test public void firebaseServiceRecreationPreservesBindingAndCanPostFurtherMessages() {
        receive(1); manager.cancel(social().getTag(), PushStore.NOTIFICATION);
        service.onDestroy();
        service = Robolectric.buildService(WhassabiMessagingService.class).create().get();
        receive(2); assertNotNull(social()); assertEquals(2, social().getNotification().number);
        receive(1); assertEquals(2, social().getNotification().number);
        receive(3); assertEquals(3, social().getNotification().number);
    }
    @Test public void foregroundAndLogoutClearOnlySocialNotificationsAndAccountChangesRejectOldPushes() {
        manager.createNotificationChannel(new NotificationChannel("fixture_room", "Voice room", NotificationManager.IMPORTANCE_LOW));
        manager.notify(1001, new NotificationCompat.Builder(context, "fixture_room").setSmallIcon(android.R.drawable.ic_btn_speak_now).build());
        receive(1); assertNotNull(social());
        PushStore.opened(context); assertNull(social());
        assertEquals(1001, manager.getActiveNotifications()[0].getId());
        receive(2); assertNull(social());
        PushStore.visible = false; receive(3); assertEquals(1, social().getNotification().number);
        bind("cccccccccccc", "next-binding"); assertNull(social());
        receive(4); assertNull(social());
        receive(5, "cccccccccccc", "next-binding"); assertEquals(1, social().getNotification().number);
        PushStore.clear(context); assertNull(social());
        assertEquals(1001, manager.getActiveNotifications()[0].getId());
        receive(6, "cccccccccccc", "next-binding"); assertNull(social());
    }
    @Test public void permissionDenialDoesNotConsumeMessagesOrPostNotifications() {
        Shadows.shadowOf(manager).setNotificationsEnabled(false);
        receive(1); assertNull(social());
        Shadows.shadowOf(manager).setNotificationsEnabled(true);
        receive(2); assertEquals(1, social().getNotification().number);
    }
}
