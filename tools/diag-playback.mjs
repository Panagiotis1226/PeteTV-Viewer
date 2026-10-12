// Diagnostic: play the mock MP4 directly and via the proxy, report errors. Needs mock (:9090) + server (:8080).
import { chromium } from '@playwright/test';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage();
await p.goto('http://localhost:8080/');
const mp4 = 'http://localhost:9090/movie/demo/demo/1001.mp4';
const cases = { direct: mp4, proxied: '/api/proxy?url=' + encodeURIComponent(mp4), hlsNative: 'http://localhost:9090/hls/index.m3u8' };
for (const [name, src] of Object.entries(cases)) {
  const r = await p.evaluate((src) => new Promise((res) => {
    const v = document.createElement('video');
    v.muted = true; v.src = src; document.body.append(v);
    v.onerror = () => res('ERROR ' + v.error?.code + ' ' + v.error?.message);
    v.play().catch(() => {});
    setTimeout(() => res('t=' + v.currentTime.toFixed(2) + ' rs=' + v.readyState + ' canAAC=' + v.canPlayType('audio/mp4; codecs="mp4a.40.2"')), 6000);
  }), src);
  console.log(name, r);
}
// Compare proxied bytes with direct bytes
const [a, c] = await Promise.all([fetch(mp4).then((r) => r.arrayBuffer()), fetch('http://localhost:8080' + cases.proxied).then((r) => r.arrayBuffer())]);
console.log('bytes direct', a.byteLength, 'proxied', c.byteLength, 'equal', Buffer.from(a).equals(Buffer.from(c)));
await b.close();
