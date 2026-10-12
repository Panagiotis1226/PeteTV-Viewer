import { play } from '../player';
import { DEFAULT_UA, platform } from '../platform';
import { activePlaylist, state, xtreamFor } from '../store';
import type { HistoryEntry, Item, PlayItem } from '../types';

export function userAgent(): string {
  return activePlaylist()?.userAgent || DEFAULT_UA;
}

/** Resolve the playable URL for a live channel or movie. */
export function itemUrl(it: Item): string {
  if (it.url) return it.url;
  const x = xtreamFor();
  if (!x || it.xid === undefined) return '';
  if (it.kind === 'live') {
    const f = state.settings.liveFormat;
    // ExoPlayer handles raw MPEG-TS best; browsers and AVPlayer (iOS) need HLS.
    return x.liveUrl(it.xid, f === 'auto' ? (platform === 'android' ? 'ts' : 'm3u8') : f);
  }
  return x.movieUrl(it.xid, it.ext);
}

export const toPlayItem = (it: Item): PlayItem => ({ id: it.id, title: it.name, url: itemUrl(it), logo: it.logo });

export function playLive(list: Item[], index: number) {
  play({ kind: 'live', items: list.map(toPlayItem), index, userAgent: userAgent() });
}

export function playMovie(it: Item, startPosition = 0) {
  play({ kind: 'movie', items: [toPlayItem(it)], index: 0, startPosition, userAgent: userAgent() });
}

export function playHistory(h: HistoryEntry) {
  if (!h.url) return;
  play({
    kind: h.kind,
    items: [{ id: h.id, title: h.name, url: h.url, logo: h.logo }],
    index: 0,
    startPosition: h.position,
    seriesId: h.seriesId,
    userAgent: userAgent(),
  });
}
