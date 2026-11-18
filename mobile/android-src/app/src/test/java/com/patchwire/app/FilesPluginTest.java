package com.patchwire.app;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28, manifest = Config.NONE)
public class FilesPluginTest {
    @Test public void downloadDestinationsCannotSendAccountCredentialsToOtherOriginsOrPaths() {
        String origin = "https://patchwire.whassabi.workers.dev", id = "aaaaaaaaaaaa";
        assertEquals(origin + "/api/files/" + id, FilesPlugin.downloadUrl(origin, origin + "/neon", id));
        assertNull(FilesPlugin.downloadUrl("https://evil.invalid", origin, id));
        assertNull(FilesPlugin.downloadUrl(origin, "https://evil.invalid", id));
        assertNull(FilesPlugin.downloadUrl(origin + "@evil.invalid", origin, id));
        assertNull(FilesPlugin.downloadUrl(origin + "/redirect", origin, id));
        assertNull(FilesPlugin.downloadUrl(origin, origin, "../private"));
        assertNull(FilesPlugin.downloadUrl(origin + "?token=x", origin, id));
    }
    @Test public void fileSavingCopiesBytesAndRejectsEmptyOrOversizedDownloads() throws Exception {
        byte[] bytes = new byte[300000]; bytes[0] = 42; bytes[299999] = 99;
        ByteArrayOutputStream output = new ByteArrayOutputStream(); FilesPlugin.copy(new ByteArrayInputStream(bytes), output);
        assertArrayEquals(bytes, output.toByteArray());
        try { FilesPlugin.copy(new ByteArrayInputStream(new byte[0]), output); fail("Empty download accepted"); } catch (IOException expected) {}
        try { FilesPlugin.copy(new ByteArrayInputStream(new byte[FilesPlugin.LIMIT + 1]), new ByteArrayOutputStream()); fail("Oversized download accepted"); } catch (IOException expected) {}
    }
}
