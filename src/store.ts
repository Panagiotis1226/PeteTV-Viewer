import { useEffect, useState } from 'preact/hooks';
import * as db from './storage';
import { fetchText } from './platform';
import { buildM3ULibrary } from './providers/m3u';
import { XtreamClient } from './providers/xtream';
import { applyOrder, moveInOrder, toggle } from './order';
import type {
  Category, EpgData, HistoryEntry, Item, Kind, Library, PlaylistSource, Prefs, Settings,
} from './types';

export interface State {
  ready: boolean;
  playlists: PlaylistSource[];
  settings: Settings;
  library: Library | null;
  prefs: Prefs;
  loading: string | null;
  error: string | null;
  /** TV guide (loaded lazily, see epg/index.ts) */
  epg: EpgData | null;
  epgStatus: string | null;
  epgError: string | null;
}

const emptyPrefs = (): Prefs => ({
  hiddenCategories: [], hiddenItems: [], categoryOrder: {}, itemOrder: {}, favorites: [], history: [],
});

export const state: State = {
  ready: false,
  playlists: [],
  settings: { liveFormat: 'auto', webProxy: 'auto', buffer: 'normal' },
  library: null,
  prefs: emptyPrefs(),
  loading: null,
  error: null,
  epg: null,
  epgStatus: null,
  epgError: null,
};

// ---------- subscription ----------
const subs = new Set<() => void>();
let version = 0;
export function emit() {
  version++;
  subs.forEach((f) => f());
}
export function useStore(): State {
  const [, setN] = useState(0);
  const force = () => setN((n) => n + 1);
  useEffect(() => {
    subs.add(force);
    return () => void subs.delete(force);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}
export const storeVersion = () => version;

// ---------- persistence ----------
const K_PLAYLISTS = 'playlists';
const K_SETTINGS = 'settings';
const kLib = (id: string) => `lib:${id}`;
const kPrefs = (id: string) => `prefs:${id}`;

export async function init() {
  state.playlists = (await db.get<PlaylistSource[]>(K_PLAYLISTS)) || [];
  state.settings = { ...state.settings, ...((await db.get<Settings>(K_SETTINGS)) || {}) };
  const active = activePlaylist();
  if (active) {
    state.prefs = { ...emptyPrefs(), ...((await db.get<Prefs>(kPrefs(active.id))) || {}) };
    state.library = (await db.get<Library>(kLib(active.id))) || null;
  }
  state.ready = true;
  emit();
  // Refresh stale libraries (older than 12h) in the background.
  if (active && (!state.library || Date.now() - state.library.loadedAt > 12 * 3600e3)) {
    refreshLibrary().catch(() => {});
  }
}

export function activePlaylist(): PlaylistSource | undefined {
  return state.playlists.find((p) => p.id === state.settings.activePlaylistId) || state.playlists[0];
}

export async function saveSettings(patch: Partial<Settings>) {
  state.settings = { ...state.settings, ...patch };
  await db.set(K_SETTINGS, state.settings);
  emit();
}

/** Persist immediately: prefs are small and a TV app can be killed at any moment. */
function savePrefs() {
  emit();
  const p = activePlaylist();
  if (p) db.set(kPrefs(p.id), state.prefs).catch((e) => console.error('saving prefs failed', e));
}

// ---------- playlists ----------
export async function addPlaylist(src: PlaylistSource) {
  state.playlists = state.playlists.filter((p) => p.id !== src.id).concat(src);
  await db.set(K_PLAYLISTS, state.playlists);
  await switchPlaylist(src.id);
}

/** Forget a playlist's cached TV guide (after its source changed). */
export async function clearEpg(id: string) {
  await db.del(`epg:${id}`);
  if (state.epg?.playlistId === id) state.epg = null;
  state.epgError = null;
}

export async function removePlaylist(id: string) {
  state.playlists = state.playlists.filter((p) => p.id !== id);
  await db.set(K_PLAYLISTS, state.playlists);
  await db.del(kLib(id));
  await db.del(kPrefs(id));
  await clearEpg(id);
  if (state.settings.activePlaylistId === id) {
    state.library = null;
    state.prefs = emptyPrefs();
    const next = state.playlists[0];
    await saveSettings({ activePlaylistId: next?.id });
    if (next) await switchPlaylist(next.id);
  }
  emit();
}

export async function switchPlaylist(id: string) {
  await saveSettings({ activePlaylistId: id });
  state.epg = null;
  state.epgError = null;
  state.prefs = { ...emptyPrefs(), ...((await db.get<Prefs>(kPrefs(id))) || {}) };
  state.library = (await db.get<Library>(kLib(id))) || null;
  emit();
  if (!state.library) await refreshLibrary();
}

export function xtreamFor(src = activePlaylist()): XtreamClient | null {
  return src && src.type === 'xtream' ? new XtreamClient(src, fetchText) : null;
}

/** Load (or reload) the active playlist from the provider. Throws on failure. */
export async function refreshLibrary(): Promise<void> {
  const src = activePlaylist();
  if (!src) return;
  state.loading = `Loading ${src.name}…`;
  state.error = null;
  emit();
  try {
    let lib: Library;
    if (src.type === 'xtream') {
      lib = await xtreamFor(src)!.loadLibrary(src.id);
    } else {
      const text = src.text ?? (await fetchText(src.url!, src.userAgent));
      if (!/#EXTINF|#EXTM3U/i.test(text.slice(0, 4096))) throw new Error('This does not look like an M3U playlist');
      lib = buildM3ULibrary(src.id, text);
    }
    if (!lib.items.length) throw new Error('The playlist loaded but contains no channels');
    state.library = lib;
    await db.set(kLib(src.id), lib);
  } catch (e) {
    state.error = (e as Error).message || String(e);
    throw e;
  } finally {
    state.loading = null;
    emit();
  }
}

// ---------- derived views (memoized per store version) ----------
let idx: {
  lib: Library | null;
  byCat: Map<string, Item[]>;
  byId: Map<string, Item>;
  cats: Map<Kind, Category[]>;
} | null = null;
function index() {
  if (idx && idx.lib === state.library) return idx;
  const byCat = new Map<string, Item[]>();
  const byId = new Map<string, Item>();
  const cats = new Map<Kind, Category[]>();
  const lib = state.library;
  if (lib) {
    for (const it of lib.items) {
      byId.set(it.id, it);
      let l = byCat.get(it.categoryId);
      if (!l) byCat.set(it.categoryId, (l = []));
      l.push(it);
    }
    for (const c of lib.categories) {
      let l = cats.get(c.kind);
      if (!l) cats.set(c.kind, (l = []));
      l.push(c);
    }
  }
  idx = { lib, byCat, byId, cats };
  return idx;
}

export const getItem = (id: string) => index().byId.get(id);

/** Categories for a section, in user order. Hidden ones are excluded unless includeHidden. */
export function categoriesFor(kind: Kind, includeHidden = false): Category[] {
  const all = index().cats.get(kind) || [];
  const ordered = applyOrder(all, state.prefs.categoryOrder[kind]);
  if (includeHidden) return ordered;
  const hidden = new Set(state.prefs.hiddenCategories);
  return ordered.filter((c) => !hidden.has(c.id) && (index().byCat.get(c.id)?.length ?? 0) > 0);
}

export function itemsFor(categoryId: string, includeHidden = false): Item[] {
  const all = index().byCat.get(categoryId) || [];
  const ordered = applyOrder(all, state.prefs.itemOrder[categoryId]);
  if (includeHidden) return ordered;
  const hidden = new Set(state.prefs.hiddenItems);
  return hidden.size ? ordered.filter((i) => !hidden.has(i.id)) : ordered;
}

/** All visible items of a kind (respecting hidden categories/items and category order). */
export function allItems(kind: Kind): Item[] {
  const out: Item[] = [];
  for (const c of categoriesFor(kind)) out.push(...itemsFor(c.id));
  return out;
}

export function countsFor(kind: Kind): number {
  let n = 0;
  for (const c of categoriesFor(kind)) n += itemsFor(c.id).length;
  return n;
}

// ---------- prefs mutations ----------
export function toggleHiddenCategory(id: string) {
  state.prefs = { ...state.prefs, hiddenCategories: toggle(state.prefs.hiddenCategories, id) };
  savePrefs();
}
/** Show (visible=true) or hide every id in `ids` in one save. */
function setMany(list: string[], ids: string[], visible: boolean): string[] {
  const set = new Set(list);
  for (const id of ids) {
    if (visible) set.delete(id);
    else set.add(id);
  }
  return [...set];
}
export function setCategoriesVisible(ids: string[], visible: boolean) {
  state.prefs = { ...state.prefs, hiddenCategories: setMany(state.prefs.hiddenCategories, ids, visible) };
  savePrefs();
}
export function setItemsVisible(ids: string[], visible: boolean) {
  state.prefs = { ...state.prefs, hiddenItems: setMany(state.prefs.hiddenItems, ids, visible) };
  savePrefs();
}
export function toggleHiddenItem(id: string) {
  state.prefs = { ...state.prefs, hiddenItems: toggle(state.prefs.hiddenItems, id) };
  savePrefs();
}
export function moveCategory(kind: Kind, id: string, delta: number) {
  const ids = categoriesFor(kind, true).map((c) => c.id);
  state.prefs = { ...state.prefs, categoryOrder: { ...state.prefs.categoryOrder, [kind]: moveInOrder(ids, id, delta) } };
  savePrefs();
}
export function moveItem(categoryId: string, id: string, delta: number) {
  const ids = itemsFor(categoryId, true).map((i) => i.id);
  state.prefs = { ...state.prefs, itemOrder: { ...state.prefs.itemOrder, [categoryId]: moveInOrder(ids, id, delta) } };
  savePrefs();
}
export function resetOrder(kind: Kind) {
  const catIds = new Set((index().cats.get(kind) || []).map((c) => c.id));
  const itemOrder = { ...state.prefs.itemOrder };
  for (const k of Object.keys(itemOrder)) if (catIds.has(k)) delete itemOrder[k];
  state.prefs = {
    ...state.prefs,
    categoryOrder: { ...state.prefs.categoryOrder, [kind]: [] },
    itemOrder,
    hiddenCategories: state.prefs.hiddenCategories.filter((id) => !catIds.has(id)),
    hiddenItems: state.prefs.hiddenItems.filter((id) => !id.startsWith(kind + ':')),
  };
  savePrefs();
}
export function toggleFavorite(id: string) {
  state.prefs = { ...state.prefs, favorites: toggle(state.prefs.favorites, id) };
  savePrefs();
}
export const isFavorite = (id: string) => state.prefs.favorites.includes(id);

export function recordHistory(e: HistoryEntry) {
  const history = [e, ...state.prefs.history.filter((h) => h.id !== e.id)].slice(0, 60);
  state.prefs = { ...state.prefs, history };
  savePrefs();
}
export const historyFor = (kind: Kind) => state.prefs.history.filter((h) => h.kind === kind);
export const historyEntry = (id: string) => state.prefs.history.find((h) => h.id === id);
