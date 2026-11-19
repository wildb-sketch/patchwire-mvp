package com.patchwire.app;

import android.app.Application;
import android.content.Context;
import android.media.AudioManager;
import com.getcapacitor.JSObject;
import org.json.JSONArray;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 31, manifest = Config.NONE)
public class RoomAudioDiagnosticsTest {
    @Test public void historyIsBoundedAndSnapshotsDoNotGrowAfterCollection() throws Exception {
        Application context = RuntimeEnvironment.getApplication();
        AudioManager audio = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        RoomAudioDiagnostics trace = new RoomAudioDiagnostics();
        for (int i = 0; i < 70; i++) trace.add("event_" + i, "speaker", audio);
        JSObject report = trace.snapshot("speaker", true, 12, "auto");
        JSONArray events = report.getJSONArray("events");
        assertEquals(64, events.length()); assertEquals("event_6", events.getJSONObject(0).getString("event"));
        trace.add("later", "speaker", audio);
        assertEquals("event_69", events.getJSONObject(63).getString("event"));
        assertEquals(RoomAudioDiagnostics.BUILD, report.getString("build"));
        assertFalse(report.toString().contains(context.getPackageName()));
    }
}
