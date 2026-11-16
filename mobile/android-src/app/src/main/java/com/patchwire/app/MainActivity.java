package com.patchwire.app;

import android.content.*;
import android.net.Uri;
import android.os.*;
import com.getcapacitor.BridgeActivity;

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

    // The room transport lives in this WebView. Never leave a phantom service after its destruction.
    @Override public void onDestroy() {
        stopService(new Intent(this, RoomService.class));
        super.onDestroy();
    }
}
