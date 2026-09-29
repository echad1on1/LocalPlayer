package app.crate.player;

import android.content.Context;
import android.net.Uri;
import android.webkit.WebResourceResponse;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/**
 * Serves the UI and the data it needs to the WebView from a private https origin.
 * Nothing ever leaves the phone: every request is answered here or blocked.
 *
 * <pre>
 *   /index.html, /app.js, /app.css, /fonts/...  -> assets/web/...
 *   /api/library                               -> the scanned music library (JSON)
 *   /art/{songId}?s={px}                       -> album art as JPEG
 * </pre>
 */
final class AssetServer {
    static final String HOST = "appassets.androidplatform.net";
    static final String ORIGIN = "https://" + HOST;

    private final Context ctx;

    AssetServer(Context ctx) {
        this.ctx = ctx.getApplicationContext();
    }

    WebResourceResponse handle(Uri url) {
        if (url == null || !"https".equals(url.getScheme()) || !HOST.equals(url.getHost())) {
            return status(403, "Forbidden");
        }
        String path = url.getPath();
        if (path == null || path.isEmpty() || path.equals("/")) path = "/index.html";
        try {
            if (path.equals("/api/library")) {
                return bytes("application/json", Library.get(ctx).json.getBytes(StandardCharsets.UTF_8), false);
            }
            if (path.startsWith("/art/")) {
                long id = Long.parseLong(path.substring(5));
                int size = 300;
                String s = url.getQueryParameter("s");
                if (s != null) size = Math.max(64, Math.min(1024, Integer.parseInt(s)));
                byte[] jpg = ArtLoader.jpeg(ctx, id, size);
                if (jpg == null) return status(404, "Not Found");
                return bytes("image/jpeg", jpg, true);
            }
            if (path.contains("..")) return status(404, "Not Found");
            InputStream in = ctx.getAssets().open("web" + path);
            String mime = mime(path);
            Map<String, String> headers = new HashMap<String, String>();
            headers.put("Cache-Control", "no-cache");
            return new WebResourceResponse(mime, mime.startsWith("text/") || mime.endsWith("javascript") ? "utf-8" : null,
                    200, "OK", headers, in);
        } catch (NumberFormatException e) {
            return status(400, "Bad Request");
        } catch (IOException e) {
            return status(404, "Not Found");
        } catch (RuntimeException e) {
            return status(500, "Server Error");
        }
    }

    private static WebResourceResponse bytes(String mime, byte[] data, boolean cache) {
        Map<String, String> headers = new HashMap<String, String>();
        headers.put("Cache-Control", cache ? "max-age=86400" : "no-store");
        return new WebResourceResponse(mime, mime.equals("application/json") ? "utf-8" : null, 200, "OK", headers,
                new ByteArrayInputStream(data));
    }

    private static WebResourceResponse status(int code, String reason) {
        return new WebResourceResponse("text/plain", "utf-8", code, reason, new HashMap<String, String>(),
                new ByteArrayInputStream(new byte[0]));
    }

    private static String mime(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".js")) return "text/javascript";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".txt")) return "text/plain";
        return "application/octet-stream";
    }
}
