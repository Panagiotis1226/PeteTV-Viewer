import { Capacitor } from '@capacitor/core';
import { DEFAULT_UA, hasServer, isNative, Native, proxyUrl } from '../platform';
import { activePlaylist, emit, state } from '../store';
import * as db from '../storage';
import type { EpgData, Item, Library, PlaylistSource } from '../types';
import type { EpgJob, EpgMessage } from './worker';
import { normName, type Prog } from './xmltv';

const STALE_MS = 12 * 3600e3;
const PAST = 2 * 3600; // keep 2h of history
const AHEAD = 36 * 3600; // and a day and a half ahead
const key = (id: string) => `epg:${id}`;

/** Where this playlist's XMLTV guide lives (custom URL > Xtream xmltv.php > M3U url-tvg). */
export function epgSourceUrl(src: PlaylistSource | undefined, lib: Library | null): string | undefined {
  if (!src) return undefined;
  if (src.epgUrl) return src.epgUrl;
  if (src.type === 'xtream' && src.server) {
    return `${src.server}/xmltv.php?username=${encodeURIComponent(src.username || '')}&password=${encodeURIComponent(src.password || '')}`;
  }
  return lib?.epgUrl;
}

let loading: Promise<void> | null = null;

/** Load the cached guide; download a fresh one if allowed and it's missing or stale. */
export function ensureEpg(opts: { network: boolean }): Promise<void> {
  const src = activePlaylist();
  if (!src) return Promise.resolve();
  if (loading) return loading;
  loading = (async () => {
    if (!state.epg || state.epg.playlistId !== src.id) {
      state.epg = (await db.get<EpgData>(key(src.id))) || null;
      emit();
    }
    const now = Date.now();
    const stale = !state.epg || now - state.epg.loadedAt > STALE_MS;
    if (opts.network && stale && !state.epgError) await download(src);
  })().finally(() => { loading = null; });
  return loading;
}

export async function refreshEpg(): Promise<void> {
  const src = activePlaylist();
  if (!src) return;
  state.epgError = null;
  if (loading) await loading;
  loading = download(src).finally(() => { loading = null; });
  return loading;
}

async function download(src: PlaylistSource): Promise<void> {
  const url = epgSourceUrl(src, state.library);
  if (!url) {
    state.epgError = 'This playlist has no TV guide. Add a guide (XMLTV) URL in Settings → Edit playlist.';
    emit();
    return;
  }
  const lib = state.library;
  const live = lib ? lib.items.filter((i) => i.kind === 'live') : [];
  const ua = src.userAgent || DEFAULT_UA;
  state.epgStatus = 'Downloading TV guide…';
  state.epgError = null;
  emit();
  try {
    let fetchUrl: string;
    if (isNative) {
      const { path } = await Native.download({ url, userAgent: ua });
      fetchUrl = Capacitor.convertFileSrc('file://' + path);
    } else {
      fetchUrl = hasServer() ? new URL(proxyUrl(url, ua), location.href).href : url;
    }
    const now = Math.floor(Date.now() / 1000);
    const job: EpgJob = {
      url: fetchUrl,
      playlistId: src.id,
      source: url,
      ids: [...new Set(live.map((i) => i.epgId).filter((x): x is string => !!x))],
      names: [...new Set(live.map((i) => normName(i.name)).filter(Boolean))],
      from: now - PAST,
      to: now + AHEAD,
    };
    const result = await runWorker(job, (bytes, n) => {
      state.epgStatus = `Reading TV guide… ${(bytes / 1e6).toFixed(0)} MB, ${n.toLocaleString()} programmes`;
      emit();
    });
    if (!result.data.count) throw new Error('The TV guide loaded but has no programmes for your channels');
    state.epg = result.data;
    if (!result.saved) await db.set(key(src.id), result.data);
  } catch (e) {
    state.epgError = (e as Error).message || String(e);
  } finally {
    state.epgStatus = null;
    emit();
  }
}

function runWorker(job: EpgJob, onProgress: (bytes: number, n: number) => void) {
  return new Promise<{ data: EpgData; saved: boolean }>((resolve, reject) => {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<EpgMessage>) => {
      const m = e.data;
      if (m.type === 'progress') onProgress(m.bytes, m.programmes);
      else {
        w.terminate();
        if (m.type === 'done') resolve(m);
        else reject(new Error(m.message));
      }
    };
    w.onerror = (e) => {
      w.terminate();
      reject(new Error(e.message || 'TV guide worker failed'));
    };
    w.postMessage(job);
  });
}

let cacheFor: EpgData | null = null;
const cache = new Map<string, Prog[] | null>();

/** Programmes for a live channel (matched by guide id, then by name), as [start, stop, title, desc]. */
export function programmesFor(it: Item): Prog[] | undefined {
  const epg = state.epg;
  if (!epg || !epg.strings) return undefined;
  if (cacheFor !== epg) {
    cacheFor = epg;
    cache.clear();
  }
  let out = cache.get(it.id);
  if (out === undefined) {
    const raw = (it.epgId && epg.progs[it.epgId]) || epg.progs[epg.names[normName(it.name)]];
    out = raw ? raw.map((p) => [p[0], p[1], epg.strings[p[2]], epg.strings[p[3]]] as Prog) : null;
    cache.set(it.id, out);
  }
  return out || undefined;
}

/** Index of the programme airing at `t` (epoch seconds), or -1. */
export function airingIndex(list: Prog[], t: number): number {
  let lo = 0;
  let hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid][1] <= t) lo = mid + 1;
    else if (list[mid][0] > t) hi = mid - 1;
    else return mid;
  }
  return -1;
}

export function nowNext(it: Item, t = Date.now() / 1000): Prog[] {
  const list = programmesFor(it);
  if (!list) return [];
  const i = airingIndex(list, t);
  if (i >= 0) return list.slice(i, i + 2);
  const next = list.find((p) => p[0] > t);
  return next ? [next] : [];
}

export const fmtClock = (sec: number) => new Date(sec * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
