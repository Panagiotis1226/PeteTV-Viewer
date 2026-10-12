/// <reference lib="webworker" />
/**
 * Web Worker: downloads (streams) an XMLTV guide, gunzips it if needed and
 * keeps only programmes for the playlist's channels inside a time window.
 * Runs off the UI thread so the TV interface stays responsive.
 */
import type { EpgData } from '../types';
import { normName, XmltvParser } from './xmltv';

export interface EpgJob {
  url: string;
  playlistId: string;
  /** original guide URL, kept for display */
  source: string;
  /** tvg-id / epg_channel_id values of the playlist's live channels */
  ids: string[];
  /** normName() of the playlist's live channel names (fallback matching) */
  names: string[];
  from: number;
  to: number;
}

export type EpgMessage =
  | { type: 'progress'; bytes: number; programmes: number }
  | { type: 'done'; data: EpgData; saved: boolean }
  | { type: 'error'; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const post = (m: EpgMessage) => ctx.postMessage(m);

async function run(job: EpgJob) {
  const res = await fetch(job.url);
  if (!res.ok || !res.body) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j && j.error) msg = j.error;
    } catch { /* not JSON */ }
    throw new Error(`Could not download the TV guide (${msg})`);
  }

  // Peek at the first bytes to detect gzip (.xml.gz guides are common).
  const raw = res.body.getReader();
  const first = await raw.read();
  let bytes = first.value ? first.value.length : 0;
  let lastReport = 0;
  const counted = new ReadableStream<Uint8Array>({
    start(c) {
      if (first.value) c.enqueue(first.value);
      if (first.done) c.close();
    },
    async pull(c) {
      const r = await raw.read();
      if (r.done) return c.close();
      bytes += r.value.length;
      c.enqueue(r.value);
    },
    cancel() { raw.cancel(); },
  });
  const gz = first.value && first.value[0] === 0x1f && first.value[1] === 0x8b;
  let stream: ReadableStream<Uint8Array> = counted;
  if (gz) {
    if (typeof DecompressionStream === 'undefined') throw new Error('This device cannot unpack compressed (.gz) TV guides');
    stream = counted.pipeThrough(new DecompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>);
  }

  const wantedIds = new Set(job.ids);
  const wantedNames = new Set(job.names);
  const keep = new Set<string>();
  const names: Record<string, string> = {};
  const progs: EpgData['progs'] = {};
  const strings: string[] = [];
  const stringIndex = new Map<string, number>();
  const intern = (str: string) => {
    let i = stringIndex.get(str);
    if (i === undefined) {
      i = strings.length;
      strings.push(str);
      stringIndex.set(str, i);
    }
    return i;
  };
  let count = 0;

  const parser = new XmltvParser({
    channel(id, displayNames) {
      if (wantedIds.has(id)) keep.add(id);
      for (const n of displayNames) {
        const k = normName(n);
        if (k && wantedNames.has(k) && !(k in names)) {
          names[k] = id;
          keep.add(id);
        }
      }
    },
    programme(ch, start, stop, title, desc) {
      if (!keep.has(ch) && !wantedIds.has(ch)) return;
      if (stop <= job.from || start >= job.to) return;
      (progs[ch] || (progs[ch] = [])).push([start, stop, intern(title), intern(desc)]);
      count++;
    },
  });

  const reader = stream.getReader();
  const dec = new TextDecoder('utf-8');
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    parser.push(dec.decode(r.value, { stream: true }));
    if (bytes - lastReport > 2_000_000) {
      lastReport = bytes;
      post({ type: 'progress', bytes, programmes: count });
    }
  }
  parser.push(dec.decode());
  for (const k in progs) progs[k].sort((a, b) => a[0] - b[0]);
  const data: EpgData = { playlistId: job.playlistId, loadedAt: Date.now(), source: job.source, progs, names, strings, count };
  // Save from here so the (large) structured-clone into IndexedDB doesn't block the UI thread.
  const saved = count > 0 ? await saveToDb(`epg:${job.playlistId}`, data).catch(() => false) : false;
  post({ type: 'done', data, saved });
}

/** Same database/store as src/storage.ts. */
function saveToDb(key: string, value: unknown): Promise<boolean> {
  return new Promise((resolve) => {
    const req = indexedDB.open('petetv', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onerror = () => resolve(false);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(value, key);
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onerror = () => { db.close(); resolve(false); };
    };
  });
}

ctx.onmessage = (e: MessageEvent<EpgJob>) => {
  run(e.data).catch((err) => post({ type: 'error', message: (err && err.message) || String(err) }));
};
