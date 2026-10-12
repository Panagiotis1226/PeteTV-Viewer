package com.petetv.viewer;

import android.content.Intent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.ArrayList;
import java.util.Collections;
import org.json.JSONObject;

/** Bridge between the web UI and native features (ExoPlayer, phone setup server). */
@CapacitorPlugin(name = "PeteTV")
public class PeteTVPlugin extends Plugin {

    private SetupServer setupServer;
    private final ExecutorService io = Executors.newFixedThreadPool(4);

    /**
     * Download a provider response (M3U / Xtream JSON) to a cache file. The web UI then
     * reads it through the WebView's local server. This avoids pushing tens of MB of
     * JSON through the plugin bridge (and Capacitor's JSON re-parsing) on 1GB TV sticks.
     */
    @PluginMethod
    public void download(PluginCall call) {
        String url = call.getString("url");
        String ua = call.getString("userAgent", "VLC/3.0.21 LibVLC/3.0.21");
        if (url == null || !(url.startsWith("http://") || url.startsWith("https://"))) {
            call.reject("Invalid URL");
            return;
        }
        io.execute(() -> {
            HttpURLConnection c = null;
            try {
                URL current = new URL(url);
                for (int redirects = 0; ; redirects++) {
                    c = (HttpURLConnection) current.openConnection();
                    c.setInstanceFollowRedirects(false);
                    c.setConnectTimeout(20000);
                    c.setReadTimeout(120000);
                    c.setRequestProperty("User-Agent", ua);
                    c.setRequestProperty("Accept", "*/*");
                    int code = c.getResponseCode();
                    if (code >= 300 && code < 400 && c.getHeaderField("Location") != null && redirects < 6) {
                        // Follow redirects ourselves: HttpURLConnection won't switch http <-> https.
                        current = new URL(current, c.getHeaderField("Location"));
                        c.disconnect();
                        continue;
                    }
                    if (code >= 400) {
                        call.reject("HTTP " + code + " from provider");
                        return;
                    }
                    break;
                }
                File dir = new File(getContext().getCacheDir(), "http");
                if (!dir.exists() && !dir.mkdirs()) throw new Exception("Cache unavailable");
                File out = new File(dir, Integer.toHexString(url.hashCode()) + ".txt");
                try (InputStream in = c.getInputStream(); OutputStream os = new FileOutputStream(out)) {
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
                }
                JSObject r = new JSObject();
                r.put("path", out.getAbsolutePath());
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Network error: " + e.getMessage(), e);
            } finally {
                if (c != null) c.disconnect();
            }
        });
    }

    @PluginMethod
    public void play(PluginCall call) {
        JSArray items = call.getArray("items");
        if (items == null || items.length() == 0) {
            call.reject("Nothing to play");
            return;
        }
        PlayerActivity.Playlist pl = new PlayerActivity.Playlist();
        try {
            for (int i = 0; i < items.length(); i++) {
                JSONObject o = items.getJSONObject(i);
                pl.ids.add(o.optString("id"));
                pl.titles.add(o.optString("title"));
                pl.urls.add(o.optString("url"));
            }
        } catch (Exception e) {
            call.reject("Invalid playlist", e);
            return;
        }
        pl.index = Math.max(0, Math.min(items.length() - 1, call.getInt("index", 0)));
        pl.startMs = (long) (call.getDouble("startPosition", 0.0) * 1000);
        pl.userAgent = call.getString("userAgent", "VLC/3.0.21 LibVLC/3.0.21");
        pl.live = "live".equals(call.getString("kind"));
        // Passed through a static field: big channel lists would overflow an Intent (1MB binder limit).
        PlayerActivity.pending = pl;
        Intent intent = new Intent(getContext(), PlayerActivity.class);
        startActivityForResult(call, intent, "onPlayResult");
    }

    @ActivityCallback
    private void onPlayResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        JSObject r = new JSObject();
        r.put("index", data != null ? data.getIntExtra("index", 0) : 0);
        r.put("position", data != null ? data.getLongExtra("position", 0) / 1000.0 : 0);
        r.put("duration", data != null ? data.getLongExtra("duration", 0) / 1000.0 : 0);
        call.resolve(r);
    }

    @PluginMethod
    public void startSetupServer(PluginCall call) {
        stopServer();
        String pin = call.getString("pin", "0000");
        JSArray presets = call.getArray("userAgents");
        try {
            setupServer = new SetupServer(pin, presets != null ? presets.toString() : "[]", json -> {
                JSObject d = new JSObject();
                d.put("data", json);
                notifyListeners("setupData", d);
            });
            int port = setupServer.start();
            String ip = localIp();
            JSObject r = new JSObject();
            r.put("ip", ip);
            r.put("port", port);
            r.put("url", "http://" + ip + ":" + port);
            call.resolve(r);
        } catch (Exception e) {
            call.reject(e.getMessage(), e);
        }
    }

    @PluginMethod
    public void stopSetupServer(PluginCall call) {
        stopServer();
        call.resolve();
    }

    private void stopServer() {
        if (setupServer != null) {
            setupServer.stop();
            setupServer = null;
        }
    }

    @Override
    protected void handleOnDestroy() {
        stopServer();
        io.shutdownNow();
    }

    /** Best-guess LAN IPv4 address (Wi-Fi or Ethernet). */
    static String localIp() {
        String fallback = "127.0.0.1";
        try {
            ArrayList<NetworkInterface> ifs = Collections.list(NetworkInterface.getNetworkInterfaces());
            for (NetworkInterface ni : ifs) {
                if (!ni.isUp() || ni.isLoopback() || ni.isVirtual()) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    if (a instanceof Inet4Address && !a.isLoopbackAddress()) {
                        String ip = a.getHostAddress();
                        String name = ni.getName();
                        if (name.startsWith("wlan") || name.startsWith("eth")) return ip;
                        if (a.isSiteLocalAddress()) fallback = ip;
                    }
                }
            }
        } catch (Exception ignored) {
        }
        return fallback;
    }
}
