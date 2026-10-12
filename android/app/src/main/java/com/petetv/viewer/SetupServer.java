package com.petetv.viewer;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/**
 * Tiny LAN-only HTTP server used by "Set up from phone".
 * It serves one page; the phone posts the playlist details (protected by a
 * 4-digit PIN shown on the TV) and they are handed to the web UI.
 * Runs only while the setup screen is open.
 */
class SetupServer {
    interface Listener {
        void onData(String json);
    }

    private static final int MAX_BODY = 60 * 1024 * 1024; // pasted / uploaded M3U files can be large
    private final String pin;
    private final String uaPresetsJson;
    private final Listener listener;
    private final ExecutorService pool = Executors.newFixedThreadPool(4);
    private ServerSocket server;
    private volatile boolean running;

    SetupServer(String pin, String uaPresetsJson, Listener listener) {
        this.pin = pin;
        this.uaPresetsJson = uaPresetsJson == null ? "[]" : uaPresetsJson;
        this.listener = listener;
    }

    int start() throws IOException {
        IOException last = null;
        for (int port = 8765; port < 8775; port++) {
            try {
                ServerSocket s = new ServerSocket();
                s.setReuseAddress(true);
                s.bind(new InetSocketAddress(port));
                server = s;
                break;
            } catch (IOException e) {
                last = e;
            }
        }
        if (server == null) throw last != null ? last : new IOException("No free port");
        running = true;
        Thread t = new Thread(() -> {
            while (running) {
                try {
                    Socket c = server.accept();
                    pool.execute(() -> handle(c));
                } catch (IOException e) {
                    if (!running) break;
                }
            }
        }, "petetv-setup");
        t.setDaemon(true);
        t.start();
        return server.getLocalPort();
    }

    void stop() {
        running = false;
        try {
            if (server != null) server.close();
        } catch (IOException ignored) {
        }
        pool.shutdownNow();
    }

    private void handle(Socket c) {
        try (Socket s = c) {
            s.setSoTimeout(30000);
            InputStream in = new BufferedInputStream(s.getInputStream());
            String requestLine = readLine(in);
            if (requestLine == null) return;
            String[] parts = requestLine.split(" ");
            String method = parts.length > 0 ? parts[0] : "";
            String path = parts.length > 1 ? parts[1] : "/";
            int length = 0;
            String line;
            while ((line = readLine(in)) != null && !line.isEmpty()) {
                int i = line.indexOf(':');
                if (i > 0 && line.substring(0, i).trim().toLowerCase(Locale.ROOT).equals("content-length")) {
                    length = Integer.parseInt(line.substring(i + 1).trim());
                }
            }
            OutputStream out = s.getOutputStream();
            if ("GET".equals(method) && (path.equals("/") || path.startsWith("/?"))) {
                respond(out, 200, "text/html; charset=utf-8", PAGE.replace("__UA_PRESETS__", uaPresetsJson.replace("</", "<\\/")));
            } else if ("POST".equals(method) && path.equals("/submit")) {
                if (length <= 0 || length > MAX_BODY) {
                    respond(out, 413, "application/json", "{\"error\":\"Playlist too large\"}");
                    return;
                }
                byte[] body = readFully(in, length);
                JSONObject o = new JSONObject(new String(body, StandardCharsets.UTF_8));
                if (!pin.equals(o.optString("pin"))) {
                    respond(out, 403, "application/json", "{\"error\":\"Wrong PIN — check the number on your TV\"}");
                    return;
                }
                JSONObject payload = o.getJSONObject("playlist");
                listener.onData(payload.toString());
                respond(out, 200, "application/json", "{\"ok\":true}");
            } else {
                respond(out, 404, "text/plain", "Not found");
            }
        } catch (Exception ignored) {
        }
    }

    private static String readLine(InputStream in) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        int ch;
        while ((ch = in.read()) != -1) {
            if (ch == '\n') break;
            if (ch != '\r') b.write(ch);
            if (b.size() > 8192) throw new IOException("Header too long");
        }
        if (ch == -1 && b.size() == 0) return null;
        return b.toString("UTF-8");
    }

    private static byte[] readFully(InputStream in, int length) throws IOException {
        byte[] buf = new byte[length];
        int off = 0;
        while (off < length) {
            int n = in.read(buf, off, length - off);
            if (n < 0) throw new IOException("Unexpected end of body");
            off += n;
        }
        return buf;
    }

    private static void respond(OutputStream out, int status, String type, String body) throws IOException {
        byte[] b = body.getBytes(StandardCharsets.UTF_8);
        String head = "HTTP/1.1 " + status + " OK\r\nContent-Type: " + type + "\r\nContent-Length: " + b.length
                + "\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n";
        out.write(head.getBytes(StandardCharsets.UTF_8));
        out.write(b);
        out.flush();
    }

    private static final String PAGE = "<!doctype html><html><head><meta charset=utf-8>"
            + "<meta name=viewport content='width=device-width,initial-scale=1'><title>PeteTV setup</title><style>"
            + "body{font-family:system-ui,sans-serif;background:#0b0f17;color:#eef2fb;margin:0;padding:20px;max-width:520px;margin:auto}"
            + "h1{font-size:26px}h1 span{color:#4f8cff}label{display:block;margin:14px 0 4px;color:#94a0bb;font-size:14px}"
            + "input,textarea,select{width:100%;box-sizing:border-box;padding:12px;border-radius:10px;border:1px solid #2a3550;background:#171f30;color:#fff;font-size:16px}"
            + ".tabs{display:flex;gap:8px;margin:16px 0}.tabs button{flex:1;padding:10px;border-radius:99px;border:1px solid #2a3550;background:#171f30;color:#fff;font-size:14px}"
            + ".tabs button.on{background:#4f8cff;border-color:#4f8cff}.go{margin-top:22px;width:100%;padding:14px;border:0;border-radius:12px;background:#4f8cff;color:#fff;font-size:18px;font-weight:600}"
            + ".msg{margin-top:16px;padding:12px;border-radius:10px;display:none}.ok{background:#12351f;display:block}.err{background:#3a1620;display:block}.hide{display:none}"
            + "</style></head><body><h1>Pete<span>TV</span> setup</h1><p style='color:#94a0bb'>Send a playlist to your TV. Everything stays on your local network.</p>"
            + "<label>PIN shown on the TV</label><input id=pin inputmode=numeric maxlength=4 autocomplete=off>"
            + "<div class=tabs><button id=t-xtream class=on onclick=\"tab('xtream')\">Xtream Codes</button><button id=t-m3u onclick=\"tab('m3u')\">M3U URL</button><button id=t-file onclick=\"tab('file')\">M3U File</button></div>"
            + "<label>Playlist name</label><input id=name placeholder='My IPTV'>"
            + "<div id=f-xtream><label>Server URL</label><input id=server placeholder='http://provider.com:8080' autocapitalize=off autocorrect=off>"
            + "<label>Username</label><input id=username autocapitalize=off autocorrect=off><label>Password</label><input id=password type=password></div>"
            + "<div id=f-m3u class=hide><label>M3U URL</label><input id=url placeholder='http://…/get.php?…' autocapitalize=off autocorrect=off></div>"
            + "<div id=f-file class=hide><label>M3U file</label><input id=file type=file accept='.m3u,.m3u8,text/plain,audio/x-mpegurl'></div>"
            + "<label>Player User-Agent (if channels won't load, pick the app that works for you)</label><select id=uasel onchange=uachg()></select>"
            + "<div id=uacustom class=hide><label>Custom User-Agent</label><input id=ua autocapitalize=off autocorrect=off></div>"
            + "<button class=go onclick=send()>Send to TV</button><div id=msg class=msg></div>"
            + "<script>var UA=__UA_PRESETS__;var sel=document.getElementById('uasel');"
            + "UA.forEach(function(p){var o=document.createElement('option');o.value=p.value;o.textContent=p.label;sel.appendChild(o)});"
            + "var c=document.createElement('option');c.value='__custom';c.textContent='Custom…';sel.appendChild(c);"
            + "function uachg(){document.getElementById('uacustom').className=sel.value==='__custom'?'':'hide'}"
            + "function uaval(){return sel.value==='__custom'?v('ua'):sel.value}"
            + "var mode='xtream';function tab(m){mode=m;['xtream','m3u','file'].forEach(function(k){"
            + "document.getElementById('f-'+k).className=k===m?'':'hide';document.getElementById('t-'+k).className=k===m?'on':''})}"
            + "function v(id){return document.getElementById(id).value.trim()}"
            + "function show(t,ok){var m=document.getElementById('msg');m.textContent=t;m.className='msg '+(ok?'ok':'err')}"
            + "async function send(){try{var p={type:mode,name:v('name'),userAgent:uaval()};"
            + "if(mode==='xtream'){p.server=v('server');p.username=v('username');p.password=document.getElementById('password').value}"
            + "else if(mode==='m3u'){p.url=v('url')}else{var f=document.getElementById('file').files[0];if(!f)return show('Choose a file first');p.text=await f.text();if(!p.name)p.name=f.name}"
            + "show('Sending…',true);var r=await fetch('/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:v('pin'),playlist:p})});"
            + "var j=await r.json();if(r.ok)show('Sent! Check your TV — it is connecting to your provider now.',true);else show(j.error||'Failed')}"
            + "catch(e){show('Could not reach the TV: '+e.message)}}</script></body></html>";
}
