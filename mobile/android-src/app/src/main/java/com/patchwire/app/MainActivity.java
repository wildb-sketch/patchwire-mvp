package com.patchwire.app;

import android.content.*;
import android.net.Uri;
import android.os.*;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;

public class MainActivity extends BridgeActivity {

    private static final String BASE = "https://patchwire.whassabi.workers.dev";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Register our bridge plugin before super.onCreate so the WebView can call it
        registerPlugin(RoomPlugin.class);
        super.onCreate(savedInstanceState);
        handleIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    /** Forward deep links like patchwire://room/1a2b3c4d into the WebView. */
    private void handleIntent(Intent intent) {
        if (intent == null) return;
        Uri data = intent.getData();
        if (data == null) return;
        String path = data.getPath(); // "/room/1a2b3c4d"
        if (path != null && path.startsWith("/room/")) {
            String roomId = path.substring(6);
            String url = BASE + "/neon#room=" + roomId;
            if (getBridge() != null && getBridge().getWebView() != null)
                getBridge().getWebView().loadUrl(url);
        }
    }

    // ---- bridge plugin: lets JavaScript start/stop/mute the foreground service ----
    @CapacitorPlugin(name = "RoomPlugin")
    public static class RoomPlugin extends Plugin {

        @PluginMethod
        public void startRoom(PluginCall call) {
            String title = call.getString("title", "Live room");
            Intent i = new Intent(getContext(), RoomService.class)
                    .setAction(RoomService.ACTION_START)
                    .putExtra(RoomService.EXTRA_TITLE, title);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                getContext().startForegroundService(i);
            else
                getContext().startService(i);
            call.resolve();
        }

        @PluginMethod
        public void stopRoom(PluginCall call) {
            getContext().startService(new Intent(getContext(), RoomService.class).setAction(RoomService.ACTION_STOP));
            call.resolve();
        }

        @PluginMethod
        public void setMuted(PluginCall call) {
            boolean muted = Boolean.TRUE.equals(call.getBoolean("muted", false));
            getContext().startService(new Intent(getContext(), RoomService.class)
                    .setAction(RoomService.ACTION_MUTE)
                    .putExtra(RoomService.EXTRA_MUTED, muted));
            call.resolve();
        }
    }
}
