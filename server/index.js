#!/usr/bin/env node
/**
 * PeteTV web server — zero dependencies.
 *
 *  - Serves the built web app (../dist)
 *  - /api/proxy?url=…  relays IPTV API calls + streams so browsers can play
 *    them (adds CORS, avoids mixed-content, sets a player User-Agent, rewrites
 *    HLS playlists so every segment also goes through the proxy).
 *
 * Environment:
 *  PORT                    (default 8080)
 *  HOST                    (default 0.0.0.0)
 *  APP_PASSWORD            optional; enables HTTP Basic auth for everything
 *  ALLOW_PRIVATE_NETWORKS  "true" lets the proxy reach LAN / localhost addresses
 *  PROXY_ALLOWED_HOSTS     optional comma list of hostnames the proxy may reach
 */
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(process.env.DIST_DIR || path.join(__dirname, '..', 'dist'));

export function configFromEnv(env = process.env) {
  return {
    port: Number(env.PORT || 8080),
    host: env.HOST || '0.0.0.0',
    password: env.APP_PASSWORD || '',
    allowPrivate: /^(1|true|yes)$/i.test(env.ALLOW_PRIVATE_NETWORKS || ''),
    allowedHosts: (env.PROXY_ALLOWED_HOSTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  };
}
let cfg = configFromEnv();
const DEFAULT_UA = 'VLC/3.0.21 LibVLC/3.0.21';
const MAX_REDIRECTS = 6;
const MAX_PLAYLIST_BYTES = 8 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

// ---------------------------------------------------------------- SSRF guard
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

/** dns.lookup wrapper that refuses private addresses (checked at connect time → no DNS rebinding). */
function safeLookup(hostname, options, cb) {
  dns.lookup(hostname, options, (err, address, family) => {
    if (err) return cb(err);
    const list = Array.isArray(address) ? address : [{ address, family }];
    if (!cfg.allowPrivate && list.some((a) => isPrivateIp(a.address))) {
      const e = new Error(`Blocked private address for ${hostname}`);
      e.code = 'EPRIVATE';
      return cb(e);
    }
    cb(null, address, family);
  });
}

function checkTarget(u) {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw Object.assign(new Error('Only http(s) URLs can be proxied'), { status: 400 });
  if (cfg.allowedHosts.length && !cfg.allowedHosts.includes(u.hostname.toLowerCase())) {
    throw Object.assign(new Error('Host not allowed by PROXY_ALLOWED_HOSTS'), { status: 403 });
  }
  if (!cfg.allowPrivate && net.isIP(u.hostname) && isPrivateIp(u.hostname)) {
    throw Object.assign(new Error('Private network addresses are blocked (set ALLOW_PRIVATE_NETWORKS=true)'), { status: 403 });
  }
}

// ---------------------------------------------------------------- upstream
function upstream(urlStr, headers, method, redirects = 0) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(urlStr);
      checkTarget(u);
    } catch (e) {
      return reject(e.status ? e : Object.assign(new Error('Invalid URL'), { status: 400 }));
    }
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(u, { method, headers, lookup: safeLookup, timeout: 20000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirects >= MAX_REDIRECTS) return reject(Object.assign(new Error('Too many redirects'), { status: 502 }));
        const next = new URL(res.headers.location, u).toString();
        return resolve(upstream(next, headers, method, redirects + 1));
      }
      res.finalUrl = u.toString();
      resolve(res);
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('Upstream timeout'), { status: 504 })));
    req.on('error', (e) => reject(Object.assign(e, { status: e.status || (e.code === 'EPRIVATE' ? 403 : 502) })));
    req.end();
  });
}

function proxied(target, ua) {
  let s = `proxy?url=${encodeURIComponent(target)}`;
  if (ua) s += `&ua=${encodeURIComponent(ua)}`;
  return s;
}

/** Rewrite every URI in an HLS playlist so it is fetched through this proxy. */
export function rewriteM3U8(text, baseUrl, ua) {
  return text.split(/\r?\n/).map((line) => {
    const t = line.trim();
    if (!t) return line;
    if (t.startsWith('#')) {
      return line.replace(/URI="([^"]+)"/g, (_m, uri) => `URI="${proxied(new URL(uri, baseUrl).toString(), ua)}"`);
    }
    return proxied(new URL(t, baseUrl).toString(), ua);
  }).join('\n');
}

function isHlsResponse(res, url) {
  const ct = String(res.headers['content-type'] || '').toLowerCase();
  return ct.includes('mpegurl') || /\.m3u8(\?|$)/i.test(new URL(url).pathname);
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Range, Content-Type',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
};

async function handleProxy(req, res, query) {
  const target = query.get('url');
  if (!target) return sendJson(res, 400, { error: 'Missing url parameter' });
  const ua = query.get('ua') || DEFAULT_UA;
  const headers = { 'User-Agent': ua, Accept: '*/*', Connection: 'keep-alive' };
  if (req.headers.range) headers.Range = req.headers.range;
  let up;
  try {
    up = await upstream(target, headers, req.method === 'HEAD' ? 'HEAD' : 'GET');
  } catch (e) {
    return sendJson(res, e.status || 502, { error: e.message });
  }
  // Abort the upstream download when the browser goes away (channel zapping!)
  res.on('close', () => up.destroy());

  if (up.statusCode < 400 && isHlsResponse(up, up.finalUrl)) {
    // Buffer the playlist. HLS playlists (with #EXT-X- tags) get their URIs
    // rewritten; IPTV channel lists share the same MIME type and pass through.
    const chunks = [];
    let size = 0;
    let streaming = false;
    const head = { ...CORS, 'Cache-Control': 'no-cache' };
    up.on('data', (c) => {
      if (streaming) return;
      size += c.length;
      chunks.push(c);
      if (size > MAX_PLAYLIST_BYTES) {
        // Far too big for an HLS playlist: stream it through untouched.
        streaming = true;
        res.writeHead(up.statusCode, { ...head, 'Content-Type': up.headers['content-type'] || 'audio/x-mpegurl' });
        res.write(Buffer.concat(chunks));
        up.pipe(res);
      }
    });
    up.on('end', () => {
      if (streaming) return;
      const text = Buffer.concat(chunks).toString('utf8');
      if (text.includes('#EXT-X-')) {
        // Always a complete 200: the rewritten body no longer matches any upstream Range.
        res.writeHead(200, { ...head, 'Content-Type': 'application/vnd.apple.mpegurl' });
        res.end(rewriteM3U8(text, up.finalUrl, query.get('ua') || ''));
      } else {
        res.writeHead(up.statusCode, { ...head, 'Content-Type': up.headers['content-type'] || 'audio/x-mpegurl' });
        res.end(text);
      }
    });
    up.on('error', () => res.destroy());
    return;
  }

  const out = { ...CORS, 'Cache-Control': 'no-cache' };
  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified']) {
    if (up.headers[h]) out[h] = up.headers[h];
  }
  res.writeHead(up.statusCode, out);
  up.pipe(res);
  up.on('error', () => res.destroy());
}

// ---------------------------------------------------------------- static
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  let file = path.normalize(path.join(DIST, rel));
  if (!file.startsWith(DIST)) return sendJson(res, 403, { error: 'Forbidden' });
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      // SPA fallback
      file = path.join(DIST, 'index.html');
      if (!fs.existsSync(file)) {
        return send(res, 503, 'text/plain', 'Web app not built yet. Run "npm run build" first.');
      }
    }
    const ext = path.extname(file);
    const immutable = file.includes(`${path.sep}assets${path.sep}`);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

// ---------------------------------------------------------------- helpers
function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type, ...CORS });
  res.end(body);
}
function sendJson(res, status, obj) {
  if (res.headersSent) return res.destroy();
  send(res, status, 'application/json', JSON.stringify(obj));
}
function authorized(req) {
  if (!cfg.password) return true;
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return false;
  const pass = Buffer.from(h.slice(6), 'base64').toString('utf8').split(':').slice(1).join(':');
  const a = Buffer.from(pass);
  const b = Buffer.from(cfg.password);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createServer(overrides = {}) {
  cfg = { ...configFromEnv(), ...overrides };
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...CORS, 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS' });
      return res.end();
    }
    if (!authorized(req)) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="PeteTV", charset="UTF-8"' });
      return res.end('Authentication required');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Method not allowed' });
    if (url.pathname.endsWith('/api/health')) return sendJson(res, 200, { app: 'petetv', ok: true });
    if (url.pathname.endsWith('/api/proxy')) {
      return handleProxy(req, res, url.searchParams).catch((e) => sendJson(res, 500, { error: e.message }));
    }
    serveStatic(req, res, url.pathname);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createServer();
  server.listen(cfg.port, cfg.host, () => {
    console.log(`PeteTV web server listening on http://${cfg.host === '0.0.0.0' ? 'localhost' : cfg.host}:${cfg.port}`);
    if (!cfg.password) console.log('Tip: set APP_PASSWORD to require a password (recommended when exposed to the internet).');
    if (cfg.allowPrivate) console.log('ALLOW_PRIVATE_NETWORKS is on: the proxy may reach LAN addresses.');
  });
}
