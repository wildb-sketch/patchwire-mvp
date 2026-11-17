package com.patchwire.app;

import android.content.*;
import android.os.*;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Register our bridge plugin before super.onCreate so the WebView can call it
        registerPlugin(RoomPlugin.class);
        registerPlugin(PushPlugin.class);
        registerPlugin(NavigationPlugin.class);
        super.onCreate(savedInstanceState);
        handleIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    /** Queue navigation without reloading a live room's WebView or microphone. */
    private void handleIntent(Intent intent) {
        if (intent == null || intent.getBooleanExtra("whassabi_handled", false)) return;
        intent.putExtra("whassabi_handled", true);
        if ("com.patchwire.app.OPEN_PUSH".equals(intent.getAction())) {
            String recipient = intent.getStringExtra("recipient"), binding = intent.getStringExtra("binding");
            if (PushStore.matches(this, recipient, binding)) NavigationPlugin.enqueue(this,
                NavigationTarget.of(intent.getStringExtra("kind"), intent.getStringExtra("target"), recipient));
        } else if (intent.getData() != null) {
            NavigationPlugin.enqueue(this, NavigationTarget.parse(intent.getData().toString()));
        }
    }

    @Override public void onResume() { super.onResume(); PushStore.opened(this); PushPlugin.changed(); }

    private void keepRoomWebViewRunning() {
        if (!RoomService.active || getBridge() == null || getBridge().getWebView() == null) return;
        android.webkit.WebView webView = getBridge().getWebView();
        if (Build.VERSION.SDK_INT >= 26) {
            // Do not waive renderer importance simply because another Activity is on top.
            webView.setRendererPriorityPolicy(android.webkit.WebView.RENDERER_PRIORITY_IMPORTANT, false);
        }
        webView.onResume();
        webView.resumeTimers();
    }

    @Override public void onPause() {
        PushStore.visible = false;
        super.onPause();
        keepRoomWebViewRunning();
        android.util.Log.i("WhassabiRoom", "Activity paused; room active=" + RoomService.active);
    }

    @Override public void onStop() {
        PushStore.visible = false;
        super.onStop();
        keepRoomWebViewRunning();
    }

}
