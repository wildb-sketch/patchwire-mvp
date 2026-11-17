package com.patchwire.app;

import java.net.URI;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Parses destinations, never URLs to load into the WebView. */
final class NavigationTarget {
    final String kind, target, recipient;
    NavigationTarget(String kind, String target, String recipient) {
        this.kind = kind; this.target = target; this.recipient = recipient;
    }
    static NavigationTarget of(String kind, String target, String recipient) {
        if (target == null) return null;
        if (!("room".equals(kind) ? target.matches("[a-f0-9]{8}") :
                ("chat".equals(kind) || "profile".equals(kind)) && target.matches("[a-f0-9]{12}"))) return null;
        if (recipient != null && !recipient.isEmpty() && !recipient.matches("[a-f0-9]{12}")) return null;
        return new NavigationTarget(kind, target, recipient == null ? "" : recipient);
    }
    static NavigationTarget parse(String value) {
        try {
            URI uri = URI.create(value);
            if (uri.getUserInfo() != null || uri.getPort() != -1 && uri.getPort() != 443) return null;
            String scheme = uri.getScheme(), host = uri.getHost(), path = uri.getPath();
            if (("whassabi".equals(scheme) || "patchwire".equals(scheme)) && "room".equals(host) && uri.getQuery() == null && uri.getFragment() == null) {
                return of("room", path != null && path.startsWith("/") ? path.substring(1) : "", "");
            }
            if (!"https".equals(scheme) || !"patchwire.whassabi.workers.dev".equals(host)) return null;
            Matcher canonical = Pattern.compile("^/room/([a-f0-9]{8})/?$").matcher(path == null ? "" : path);
            if (canonical.matches()) return of("room", canonical.group(1), "");
            if (!("/".equals(path) || "/neon".equals(path) || "/index.html".equals(path))) return null;
            Matcher legacy = Pattern.compile("^(room|u)=([a-f0-9]+)$").matcher(uri.getFragment() == null ? "" : uri.getFragment());
            return legacy.matches() ? of("u".equals(legacy.group(1)) ? "profile" : "room", legacy.group(2), "") : null;
        } catch (RuntimeException ignored) { return null; }
    }
}
