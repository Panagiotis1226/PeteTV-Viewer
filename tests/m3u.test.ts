import { describe, expect, it } from 'vitest';
import { classify, parseEpisodeName, parseM3U } from '../src/parsers/m3u';
import { buildM3ULibrary } from '../src/providers/m3u';

const SAMPLE = `﻿#EXTM3U url-tvg="http://epg.example/guide.xml"
#EXTINF:-1 tvg-id="cnn.us" tvg-name="CNN" tvg-logo="http://x/cnn.png" group-title="News, USA",CNN HD
http://prov.tv/live/u/p/1.ts
#EXTINF:-1 tvg-id="" group-title="News, USA",BBC World
#EXTVLCOPT:http-user-agent=MyAgent/1.0
http://prov.tv/live/u/p/2.ts\r
#EXTINF:-1,No Group Channel
#EXTGRP:Misc
http://prov.tv/stream/3
#EXTINF:-1 group-title="Movies",The Matrix (1999)
http://prov.tv/movie/u/p/77.mkv
#EXTINF:-1 group-title="TV Shows",Breaking Test S01 E02
http://prov.tv/series/u/p/900.mp4
#EXTINF:-1 group-title="TV Shows",Breaking Test S01E01
http://prov.tv/series/u/p/899.mp4
#EXTINF:-1 group-title="TV Shows",Other Show S02 E10
http://prov.tv/files/other.s02e10.mp4

`;

describe('parseM3U', () => {
  const r = parseM3U(SAMPLE);
  it('reads header epg url', () => expect(r.epgUrl).toBe('http://epg.example/guide.xml'));
  it('parses all entries', () => expect(r.entries).toHaveLength(7));
  it('handles commas inside quoted attributes', () => {
    expect(r.entries[0]).toMatchObject({ name: 'CNN HD', group: 'News, USA', logo: 'http://x/cnn.png', tvgId: 'cnn.us' });
  });
  it('reads EXTVLCOPT user agent and strips CR', () => {
    expect(r.entries[1].userAgent).toBe('MyAgent/1.0');
    expect(r.entries[1].url).toBe('http://prov.tv/live/u/p/2.ts');
  });
  it('supports EXTGRP and entries without attributes', () => {
    expect(r.entries[2]).toMatchObject({ name: 'No Group Channel', group: 'Misc' });
  });
  it('handles bare URL lists', () => {
    const b = parseM3U('#EXTM3U\nhttp://a/b/c.m3u8\n');
    expect(b.entries[0]).toMatchObject({ name: 'c.m3u8', group: 'Uncategorized' });
  });
});

describe('classify', () => {
  const e = parseM3U(SAMPLE).entries;
  it('detects live, movie, series', () => {
    expect(e.map(classify)).toEqual(['live', 'live', 'live', 'movie', 'series', 'series', 'series']);
  });
  it('parses episode names', () => {
    expect(parseEpisodeName('Breaking Test S01 E02')).toEqual({ show: 'Breaking Test', season: 1, episode: 2 });
    expect(parseEpisodeName('Show.Name.S10E101.720p')).toEqual({ show: 'Show.Name', season: 10, episode: 101 });
    expect(parseEpisodeName('EN - Show | S03 E04')).toEqual({ show: 'EN - Show', season: 3, episode: 4 });
    expect(parseEpisodeName('Movie 2024')).toBeNull();
  });
});

describe('buildM3ULibrary', () => {
  const lib = buildM3ULibrary('p1', SAMPLE);
  it('groups categories per kind', () => {
    const byKind = (k: string) => lib.categories.filter((c) => c.kind === k).map((c) => c.name);
    expect(byKind('live')).toEqual(['News, USA', 'Misc']);
    expect(byKind('movie')).toEqual(['Movies']);
    expect(byKind('series')).toEqual(['TV Shows']);
  });
  it('builds series with sorted episodes', () => {
    const shows = lib.items.filter((i) => i.kind === 'series');
    expect(shows.map((s) => s.name)).toEqual(['Breaking Test', 'Other Show']);
    const eps = lib.episodes![shows[0].id];
    expect(eps.map((e) => e.episode)).toEqual([1, 2]);
  });
  it('produces stable ids across reloads', () => {
    const again = buildM3ULibrary('p1', SAMPLE);
    expect(again.items.map((i) => i.id)).toEqual(lib.items.map((i) => i.id));
  });
  it('dedupes duplicate names in a group', () => {
    const l = buildM3ULibrary('p', '#EXTM3U\n#EXTINF:-1 group-title="A",X\nhttp://1\n#EXTINF:-1 group-title="A",X\nhttp://2\n');
    expect(new Set(l.items.map((i) => i.id)).size).toBe(2);
  });
  it('parses a large playlist quickly', () => {
    const lines = ['#EXTM3U'];
    for (let i = 0; i < 100000; i++) lines.push(`#EXTINF:-1 tvg-id="c${i}" tvg-logo="http://l/${i}.png" group-title="G${i % 300}",Channel ${i}`, `http://p/live/u/p/${i}.ts`);
    const t = performance.now();
    const big = buildM3ULibrary('big', lines.join('\n'));
    const ms = performance.now() - t;
    expect(big.items).toHaveLength(100000);
    expect(ms).toBeLessThan(3000);
  });
});
