import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

let app: Server;
let mock: Server;
let appBase = '';
let mockBase = '';

beforeAll(async () => {
  // @ts-expect-error plain JS module
  const { createMockServer } = await import('../tools/mock-iptv/server.js');
  mock = createMockServer();
  await new Promise<void>((r) => mock.listen(0, '127.0.0.1', () => r()));
  mockBase = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;
}, 120000);
afterAll(() => { app?.close(); mock?.close(); });

async function startApp(over: Record<string, unknown>) {
  // @ts-expect-error plain JS module
  const mod = await import('../server/index.js');
  app?.close();
  app = mod.createServer(over);
  await new Promise<void>((r) => app.listen(0, '127.0.0.1', () => r()));
  appBase = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
  return mod;
}

describe('web server', () => {
  it('blocks private addresses by default (SSRF guard)', async () => {
    await startApp({ allowPrivate: false, password: '' });
    const r = await fetch(`${appBase}/api/proxy?url=${encodeURIComponent(mockBase + '/get.php')}`);
    expect(r.status).toBe(403);
    const r2 = await fetch(`${appBase}/api/proxy?url=${encodeURIComponent('file:///etc/passwd')}`);
    expect(r2.status).toBe(400);
  });

  it('proxies API calls with CORS and rewrites HLS playlists', async () => {
    await startApp({ allowPrivate: true, password: '' });
    expect(await (await fetch(`${appBase}/api/health`)).json()).toEqual({ app: 'petetv', ok: true });
    const api = await fetch(`${appBase}/api/proxy?url=${encodeURIComponent(mockBase + '/player_api.php?username=demo&password=demo')}`);
    expect(api.headers.get('access-control-allow-origin')).toBe('*');
    expect((await api.json()).user_info.auth).toBe(1);
    // live .m3u8 redirects to /hls/index.m3u8 -> rewritten relative to the final URL
    const hls = await (await fetch(`${appBase}/api/proxy?url=${encodeURIComponent(mockBase + '/live/demo/demo/1.m3u8')}`)).text();
    const segLine = hls.split('\n').find((l) => l.startsWith('proxy?url='))!;
    expect(decodeURIComponent(segLine.slice(10))).toBe(`${mockBase}/hls/seg000.ts`);
    const seg = await fetch(`${appBase}/api/${segLine}`);
    expect(seg.status).toBe(200);
    expect((await seg.arrayBuffer()).byteLength).toBeGreaterThan(1000);
  });

  it('passes IPTV M3U lists (same MIME type as HLS) through without rewriting', async () => {
    const r = await fetch(`${appBase}/api/proxy?url=${encodeURIComponent(mockBase + '/playlist.m3u')}`);
    const text = await r.text();
    expect(text).toContain(`${mockBase.replace('127.0.0.1', '127.0.0.1')}/live/demo/demo/1.ts`);
    expect(text).not.toContain('proxy?url=');
  });

  it('forwards Range requests for seeking', async () => {
    const r = await fetch(`${appBase}/api/proxy?url=${encodeURIComponent(mockBase + '/movie/demo/demo/1001.mp4')}`, { headers: { Range: 'bytes=100-199' } });
    expect(r.status).toBe(206);
    expect(r.headers.get('content-range')).toMatch(/^bytes 100-199\//);
    expect((await r.arrayBuffer()).byteLength).toBe(100);
  });

  it('requires a password when APP_PASSWORD is set', async () => {
    await startApp({ allowPrivate: true, password: 's3cret' });
    expect((await fetch(`${appBase}/api/health`)).status).toBe(401);
    const ok = await fetch(`${appBase}/api/health`, { headers: { Authorization: 'Basic ' + Buffer.from('any:s3cret').toString('base64') } });
    expect(ok.status).toBe(200);
  });

  it('rewrites URI attributes in HLS tags', async () => {
    const { rewriteM3U8 } = await startApp({});
    const out = rewriteM3U8('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\nseg1.ts\n', 'http://h/a/b.m3u8', '');
    expect(out).toContain(`URI="proxy?url=${encodeURIComponent('http://h/a/key.bin')}"`);
    expect(out).toContain(`proxy?url=${encodeURIComponent('http://h/a/seg1.ts')}`);
  });
});
