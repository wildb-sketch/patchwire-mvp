package com.patchwire.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Saves authenticated attachments through Android's picker, without storage permissions. */
@CapacitorPlugin(name = "FilesPlugin")
public class FilesPlugin extends Plugin {
    static final int LIMIT = 10 * 1024 * 1024;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private volatile boolean saving;

    static String downloadUrl(String origin, String page, String id) {
        if (origin == null || page == null || id == null || !id.matches("[a-f0-9]{12}")) return null;
        Uri server = Uri.parse(origin), current = Uri.parse(page);
        if (!"https".equals(server.getScheme()) || !"https".equals(current.getScheme()) ||
                !"patchwire.whassabi.workers.dev".equals(server.getAuthority()) || !server.getAuthority().equals(current.getAuthority()) ||
                server.getUserInfo() != null || server.getQuery() != null || server.getFragment() != null ||
                !(server.getPath() == null || server.getPath().isEmpty() || "/".equals(server.getPath()))) return null;
        return "https://patchwire.whassabi.workers.dev/api/files/" + id;
    }
    @PluginMethod public void save(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            String page = getBridge().getWebView().getUrl();
            if (downloadUrl(call.getString("origin"), page, call.getString("id")) == null || !call.getString("token", "").matches("[a-f0-9]{48}")) {
                call.reject("File is unavailable.", "INVALID_FILE"); return;
            }
            if (saving) { call.reject("Finish saving the previous file first.", "SAVE_BUSY"); return; }
            saving = true;
            String name = call.getString("name", "attachment").replaceAll("[\\\\/\\p{Cntrl}]", "_");
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                .setType("application/octet-stream").putExtra(Intent.EXTRA_TITLE, name.substring(0, Math.min(180, name.length())));
            try { startActivityForResult(call, intent, "saveResult"); }
            catch (RuntimeException error) { saving = false; call.reject("The Android file picker is unavailable.", "PICKER_UNAVAILABLE"); }
        });
    }
    @ActivityCallback private void saveResult(PluginCall call, ActivityResult result) {
        if (call == null) { saving = false; return; }
        Uri document = result.getData() == null ? null : result.getData().getData();
        if (result.getResultCode() != Activity.RESULT_OK || document == null) {
            saving = false; JSObject response = new JSObject(); response.put("cancelled", true); call.resolve(response); return;
        }
        final String address = downloadUrl(call.getString("origin"), getBridge().getWebView().getUrl(), call.getString("id"));
        if (address == null) { saving = false; call.reject("File is unavailable.", "INVALID_FILE"); return; }
        io.execute(() -> {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(address).openConnection();
                connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(15000); connection.setReadTimeout(30000);
                connection.setRequestProperty("Authorization", "Bearer " + call.getString("token", ""));
                if (connection.getResponseCode() != 200 || connection.getContentLength() > LIMIT) throw new IOException();
                try (InputStream input = connection.getInputStream(); OutputStream output = getContext().getContentResolver().openOutputStream(document, "w")) {
                    if (output == null) throw new IOException();
                    int size = copy(input, output), expected = connection.getContentLength();
                    if (expected >= 0 && size != expected) throw new IOException("Incomplete download");
                }
                call.resolve();
            } catch (Exception error) {
                try { getContext().getContentResolver().delete(document, null, null); } catch (RuntimeException ignored) {}
                call.reject("Could not save the file. Check your connection and try again.", "SAVE_FAILED");
            } finally { if (connection != null) connection.disconnect(); saving = false; }
        });
    }
    static int copy(InputStream input, OutputStream output) throws IOException {
        byte[] buffer = new byte[16384]; int size, total = 0;
        while ((size = input.read(buffer)) != -1) {
            total += size; if (total > LIMIT) throw new IOException("File limit exceeded");
            output.write(buffer, 0, size);
        }
        if (total == 0) throw new IOException("Empty file");
        return total;
    }
    @Override protected void handleOnDestroy() { io.shutdown(); }
}
