import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
// @ts-expect-error plain JS module
import { createMockServer } from '../tools/mock-iptv/server.js';
import { XtreamClient } from '../src/providers/xtream';
import { buildM3ULibrary } from '../src/providers/m3u';
import type { PlaylistSource } from '../src/types';

let server: Server;
let base = '';
const fetchText = async (url: string) => (await fetch(url)).text();

beforeAll(async () => {
  server = createMockServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 120000);
afterAll(() => server.close());

const src = (over: Partial<PlaylistSource> = {}): PlaylistSource => ({
  id: 'x', name: 'X', type: 'xtream', server: base, username: 'demo', password: 'demo', createdAt: 0, ...over,
});

describe('XtreamClient', () => {
  it('rejects bad credentials', async () => {
    await expect(new XtreamClient(src({ password: 'nope' }), fetchText).login()).rejects.toThrow(/Login failed/);
  });
  it('loads a full library', async () => {
    const lib = await new XtreamClient(src(), fetchText).loadLibrary('x');
    expect(lib.account?.status).toBe('Active');
    expect(lib.categories.filter((c) => c.kind === 'live')).toHaveLength(4);
    expect(lib.items.filter((i) => i.kind === 'live')).toHaveLength(10);
    expect(lib.items.filter((i) => i.kind === 'movie')).toHaveLength(3);
    expect(lib.items.filter((i) => i.kind === 'series')).toHaveLength(2);
  });
  it('builds stream urls', () => {
    const x = new XtreamClient(src({ username: 'a b', password: 'p/w' }), fetchText);
    expect(x.liveUrl(5, 'ts')).toBe(`${base}/live/a%20b/p%2Fw/5.ts`);
    expect(x.movieUrl(7, 'mkv')).toBe(`${base}/movie/a%20b/p%2Fw/7.mkv`);
  });
  it('loads series episodes and movie info', async () => {
    const x = new XtreamClient(src(), fetchText);
    const s = await x.seriesInfo(501);
    expect(s.seasons).toEqual([1, 2]);
    expect(s.episodes).toHaveLength(6);
    expect(s.episodes[0].url).toBe(`${base}/series/demo/demo/50111.mp4`);
    const m = await x.movieInfo(1001);
    expect(m.director).toBe('Eve');
    const epg = await x.shortEpg(1);
    expect(epg[0].title).toBe('Morning Show');
  });
  it('M3U export of the same account classifies correctly', async () => {
    const text = await fetchText(`${base}/get.php?username=demo&password=demo&type=m3u_plus`);
    const lib = buildM3ULibrary('m', text);
    expect(lib.items.filter((i) => i.kind === 'live')).toHaveLength(11);
    expect(lib.items.filter((i) => i.kind === 'movie')).toHaveLength(3);
    expect(lib.items.filter((i) => i.kind === 'series').map((i) => i.name)).toEqual(['Test Drama', 'Space Test']);
  });
});
