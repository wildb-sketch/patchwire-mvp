package com.patchwire.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class NavigationTargetTest {
    @Test public void canonicalAndLegacyRoomLinksResolveWithoutAWebViewReload() {
        for (String link : new String[] { "https://patchwire.whassabi.workers.dev/room/abcdef12", "https://patchwire.whassabi.workers.dev/#room=abcdef12",
                "https://patchwire.whassabi.workers.dev/neon#room=abcdef12", "patchwire://room/abcdef12", "whassabi://room/abcdef12" }) {
            NavigationTarget target = NavigationTarget.parse(link);
            assertNotNull(link, target); assertEquals("room", target.kind); assertEquals("abcdef12", target.target);
        }
    }
    @Test public void arbitraryHostsCredentialsPathsAndInvalidIdsAreRejected() {
        for (String link : new String[] { "https://evil.test/room/abcdef12", "https://patchwire.whassabi.workers.dev.evil.test/room/abcdef12", "http://patchwire.whassabi.workers.dev/room/abcdef12",
                "https://user@patchwire.whassabi.workers.dev/room/abcdef12", "https://patchwire.whassabi.workers.dev:444/room/abcdef12", "javascript:alert(1)",
                "whassabi://room/abcdef12/extra", "whassabi://evil/abcdef12", "https://patchwire.whassabi.workers.dev/room/nope" }) assertNull(link, NavigationTarget.parse(link));
        assertNull(NavigationTarget.of("room", null, ""));
        assertNull(NavigationTarget.of("chat", "aabbccddeeff", "wrong"));
    }
}
