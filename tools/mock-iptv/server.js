#!/usr/bin/env node
/**
 * Mock IPTV provider for development & automated tests.
 * Implements the Xtream Codes player API + get.php M3U export and serves
 * small ffmpeg-generated test streams (HLS, MPEG-TS, MP4).
 *
 *   node tools/mock-iptv/server.js            -> http://localhost:9090
 *   username: demo   password: demo
 *   M3U:      http://localhost:9090/get.php?username=demo&password=demo&type=m3u_plus
 *   MOCK_SIZE=20000 for a large playlist (performance testing)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MEDIA = path.join(__dirname, 'media');
const PORT = Number(process.env.MOCK_PORT || 9090);
const SIZE = Number(process.env.MOCK_SIZE || 0);
const USER = 'demo';
const PASS = 'demo';

function ensureMedia() {
  if (fs.existsSync(path.join(MEDIA, 'hls', 'index.m3u8'))) return;
  fs.mkdirSync(path.join(MEDIA, 'hls'), { recursive: true });
  const src = ['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100'];
  const enc = ['-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'baseline', '-pix_fmt', 'yuv420p', '-g', '50', '-c:a', 'aac', '-b:a', '96k'];
  console.log('Generating test media with ffmpeg…');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...src, '-t', '40', ...enc, '-movflags', '+faststart', path.join(MEDIA, 'movie.mp4')]);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...src, '-t', '40', ...enc, '-f', 'mpegts', path.join(MEDIA, 'live.ts')]);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...src, '-t', '40', ...enc, '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod',
    '-hls_segment_filename', path.join(MEDIA, 'hls', 'seg%03d.ts'), path.join(MEDIA, 'hls', 'index.m3u8')]);
}

// ---------------------------------------------------------------- catalogue
const liveCats = [
  { category_id: '1', category_name: 'News' },
  { category_id: '2', category_name: 'Sports' },
  { category_id: '3', category_name: 'Kids' },
  { category_id: '4', category_name: 'Adult (hide me)' },
];
const vodCats = [{ category_id: '10', category_name: 'Action' }, { category_id: '11', category_name: 'Comedy' }];
const seriesCats = [{ category_id: '20', category_name: 'Drama' }, { category_id: '21', category_name: 'Sci-Fi' }];

const live = [];
const names = { 1: ['CNN Test', 'BBC Test', 'Sky News Test'], 2: ['ESPN Test', 'Sky Sports Test', 'beIN Test'], 3: ['Cartoon Test', 'Nick Test'], 4: ['Hidden One', 'Hidden Two'] };
let sid = 1;
for (const [cid, list] of Object.entries(names)) for (const n of list) live.push({ num: sid, name: n, stream_type: 'live', stream_id: sid++, stream_icon: '', epg_channel_id: n.toLowerCase().replace(/\W+/g, '.'), category_id: cid });
for (let i = 0; i < SIZE; i++) live.push({ num: sid, name: `Bulk Channel ${i + 1}`, stream_type: 'live', stream_id: sid++, stream_icon: '', category_id: String(100 + (i % 200)) });
for (let i = 0; i < (SIZE ? 200 : 0); i++) liveCats.push({ category_id: String(100 + i), category_name: `Bulk Group ${i + 1}` });

const vod = [
  { stream_id: 1001, name: 'Test Movie One', stream_icon: '', rating: '7.4', category_id: '10', container_extension: 'mp4', added: '1700000000' },
  { stream_id: 1002, name: 'Test Movie Two', stream_icon: '', rating: '6.1', category_id: '10', container_extension: 'mp4', added: '1700000001' },
  { stream_id: 1003, name: 'Funny Test Movie', stream_icon: '', rating: '8.0', category_id: '11', container_extension: 'mp4', added: '1700000002' },
];
const series = [
  { series_id: 501, name: 'Test Drama', cover: '', plot: 'A dramatic test series.', rating: '8.2', category_id: '20', releaseDate: '2021-01-01' },
  { series_id: 502, name: 'Space Test', cover: '', plot: 'Tests, in space.', rating: '7.7', category_id: '21', releaseDate: '2023-05-01' },
];
function seriesInfo(id) {
  const s = series.find((x) => x.series_id === id);
  const episodes = {};
  for (let season = 1; season <= 2; season++) {
    episodes[season] = [1, 2, 3].map((e) => ({
      id: String(id * 100 + season * 10 + e), episode_num: e, title: `${s.name} S0${season}E0${e}`, container_extension: 'mp4', season,
      info: { plot: `Episode ${e} of season ${season}`, duration: '00:00:40' },
    }));
  }
  return { info: { name: s.name, plot: s.plot, genre: 'Testing', cast: 'Alice, Bob', rating: s.rating, releaseDate: s.releaseDate }, episodes };
}

function m3u(host) {
  const base = `http://${host}`;
  const lines = ['#EXTM3U'];
  for (const c of live) {
    const cat = liveCats.find((x) => x.category_id === c.category_id);
    lines.push(`#EXTINF:-1 tvg-id="${c.epg_channel_id || ''}" tvg-name="${c.name}" tvg-logo="" group-title="${cat.category_name}",${c.name}`);
    lines.push(`${base}/live/${USER}/${PASS}/${c.stream_id}.ts`);
  }
  for (const v of vod) {
    const cat = vodCats.find((x) => x.category_id === v.category_id);
    lines.push(`#EXTINF:-1 tvg-name="${v.name}" group-title="${cat.category_name}",${v.name}`);
    lines.push(`${base}/movie/${USER}/${PASS}/${v.stream_id}.mp4`);
  }
  for (const s of series) {
    const cat = seriesCats.find((x) => x.category_id === s.category_id);
    const info = seriesInfo(s.series_id);
    for (const eps of Object.values(info.episodes)) for (const e of eps) {
      lines.push(`#EXTINF:-1 tvg-name="${s.name}" group-title="${cat.category_name}",${s.name} S0${e.season} E0${e.episode_num}`);
      lines.push(`${base}/series/${USER}/${PASS}/${e.id}.mp4`);
    }
  }
  // A plain HLS channel, like many free/public playlists
  lines.push('#EXTINF:-1 tvg-id="hls.test" group-title="News",HLS Test Channel');
  lines.push(`${base}/hls/index.m3u8`);
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------- server
function sendFile(req, res, file, type) {
  const st = fs.statSync(file);
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Number(range[2]) : st.size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes' });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes' });
  fs.createReadStream(file).pipe(res);
}

function json(res, obj) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

export function createMockServer() {
  ensureMedia();
  return http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const q = u.searchParams;
    const p = u.pathname;
    if (p === '/player_api.php') {
      if (q.get('username') !== USER || q.get('password') !== PASS) return json(res, { user_info: { auth: 0 } });
      switch (q.get('action')) {
        case null: return json(res, {
          user_info: { auth: 1, status: 'Active', exp_date: String(Math.floor(Date.now() / 1000) + 86400 * 30), max_connections: '2', active_cons: '0', username: USER },
          server_info: { url: req.headers.host, port: String(PORT) },
        });
        case 'get_live_categories': return json(res, liveCats);
        case 'get_live_streams': return json(res, live);
        case 'get_vod_categories': return json(res, vodCats);
        case 'get_vod_streams': return json(res, vod);
        case 'get_series_categories': return json(res, seriesCats);
        case 'get_series': return json(res, series);
        case 'get_series_info': return json(res, seriesInfo(Number(q.get('series_id'))));
        case 'get_vod_info': {
          const v = vod.find((x) => x.stream_id === Number(q.get('vod_id')));
          return json(res, { info: { plot: `The plot of ${v?.name}.`, genre: 'Test', cast: 'Carol, Dave', director: 'Eve', duration: '00:00:40', releasedate: '2020-02-02', rating: v?.rating } });
        }
        case 'get_short_epg': {
          const now = Math.floor(Date.now() / 1000);
          const b = (s) => Buffer.from(s).toString('base64');
          return json(res, { epg_listings: [
            { title: b('Morning Show'), start_timestamp: String(now - 600), stop_timestamp: String(now + 1200) },
            { title: b('Evening News'), start_timestamp: String(now + 1200), stop_timestamp: String(now + 3000) },
          ] });
        }
        default: return json(res, []);
      }
    }
    if (p === '/playlist.m3u') {
      res.writeHead(200, { 'Content-Type': 'audio/x-mpegurl' });
      return res.end(m3u(req.headers.host));
    }
    if (p === '/get.php') {
      if (q.get('username') !== USER || q.get('password') !== PASS) { res.writeHead(401); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'audio/x-mpegurl' });
      return res.end(m3u(req.headers.host));
    }
    let m;
    if ((m = /^\/live\/[^/]+\/[^/]+\/(\d+)\.(ts|m3u8)$/.exec(p))) {
      if (m[2] === 'm3u8') { res.writeHead(302, { Location: '/hls/index.m3u8' }); return res.end(); }
      return sendFile(req, res, path.join(MEDIA, 'live.ts'), 'video/mp2t');
    }
    if (/^\/(movie|series)\/[^/]+\/[^/]+\/\d+\.\w+$/.test(p)) return sendFile(req, res, path.join(MEDIA, 'movie.mp4'), 'video/mp4');
    if ((m = /^\/hls\/([\w.]+)$/.exec(p)) && fs.existsSync(path.join(MEDIA, 'hls', m[1]))) {
      return sendFile(req, res, path.join(MEDIA, 'hls', m[1]), m[1].endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t');
    }
    res.writeHead(404);
    res.end('not found');
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createMockServer().listen(PORT, () => console.log(`Mock IPTV on http://localhost:${PORT}  (user demo / pass demo)`));
}
