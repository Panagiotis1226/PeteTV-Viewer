export type Kind = 'live' | 'movie' | 'series';

export const KINDS: Kind[] = ['live', 'movie', 'series'];

export interface PlaylistSource {
  id: string;
  name: string;
  type: 'm3u' | 'xtream';
  /** M3U: remote URL (preferred) */
  url?: string;
  /** M3U: raw text when the playlist was uploaded as a file / pasted */
  text?: string;
  /** Xtream Codes */
  server?: string;
  username?: string;
  password?: string;
  /** Optional User-Agent override sent to the provider */
  userAgent?: string;
  /** Optional XMLTV guide URL (overrides the provider's / playlist's own) */
  epgUrl?: string;
  createdAt: number;
}

export interface Category {
  id: string;
  name: string;
  kind: Kind;
}

export interface Item {
  id: string;
  kind: Kind;
  name: string;
  categoryId: string;
  logo?: string;
  /** Direct play URL (live + movies). Series resolve episodes separately. */
  url?: string;
  /** Xtream stream / series id */
  xid?: number;
  /** container extension for xtream movies */
  ext?: string;
  epgId?: string;
  rating?: string;
  year?: string;
  plot?: string;
  added?: number;
}

export interface Episode {
  id: string;
  title: string;
  season: number;
  episode: number;
  url: string;
  logo?: string;
  plot?: string;
  duration?: string;
}

export interface SeriesInfo {
  plot?: string;
  cover?: string;
  genre?: string;
  cast?: string;
  rating?: string;
  year?: string;
  seasons: number[];
  episodes: Episode[];
}

export interface MovieInfo {
  plot?: string;
  cover?: string;
  genre?: string;
  cast?: string;
  director?: string;
  rating?: string;
  year?: string;
  duration?: string;
}

export interface Library {
  playlistId: string;
  loadedAt: number;
  categories: Category[];
  items: Item[];
  /** M3U-only: episodes grouped by series item id */
  episodes?: Record<string, Episode[]>;
  account?: AccountInfo;
  /** M3U: guide URL from the #EXTM3U url-tvg / x-tvg-url header */
  epgUrl?: string;
}

export interface AccountInfo {
  status?: string;
  expires?: number;
  maxConnections?: number;
  activeConnections?: number;
}

/** Parsed TV guide for one playlist, filtered to its channels. */
export interface EpgData {
  playlistId: string;
  loadedAt: number;
  source: string;
  /** guide channel id -> programmes [start, stop, titleIdx, descIdx] sorted by start (epoch seconds) */
  progs: Record<string, [number, number, number, number][]>;
  /** de-duplicated titles/descriptions (guides repeat them constantly) */
  strings: string[];
  /** normalized channel name -> guide channel id (fallback matching) */
  names: Record<string, string>;
  count: number;
}

export interface HistoryEntry {
  id: string;
  kind: Kind;
  name: string;
  logo?: string;
  /** For series: the series item id the episode belongs to */
  seriesId?: string;
  url?: string;
  position?: number;
  duration?: number;
  at: number;
}

export interface Prefs {
  hiddenCategories: string[];
  hiddenItems: string[];
  /** Custom ordering per kind for categories */
  categoryOrder: Partial<Record<Kind, string[]>>;
  /** Custom ordering of items inside a category, keyed by category id */
  itemOrder: Record<string, string[]>;
  favorites: string[];
  history: HistoryEntry[];
}

export interface Settings {
  activePlaylistId?: string;
  /** Live format for Xtream: ts works best natively, m3u8 best on web */
  liveFormat: 'auto' | 'ts' | 'm3u8';
  /** web only: route streams through the server proxy */
  webProxy: 'auto' | 'always' | 'never';
  /** Player buffer: small = fastest channel switching, xlarge = most tolerant of weak Wi-Fi */
  buffer: BufferSize;
}

export type BufferSize = 'small' | 'normal' | 'large' | 'xlarge';

export interface PlayItem {
  id: string;
  title: string;
  url: string;
  logo?: string;
}

export interface PlayRequest {
  kind: Kind;
  items: PlayItem[];
  index: number;
  startPosition?: number;
  userAgent?: string;
  /** for history bookkeeping */
  seriesId?: string;
  buffer?: BufferSize;
}

export interface PlayResult {
  index: number;
  position: number;
  duration: number;
}
