import type {
  AccountInfo, Category, Episode, Item, Kind, Library, MovieInfo, PlaylistSource, SeriesInfo,
} from '../types';

export type FetchText = (url: string, userAgent?: string) => Promise<string>;

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

function str(v: unknown): string | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  return String(v);
}

function yearOf(v: unknown): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  const m = /(\d{4})/.exec(s);
  return m ? m[1] : undefined;
}

export class XtreamClient {
  readonly base: string;
  constructor(private src: PlaylistSource, private fetchText: FetchText) {
    this.base = (src.server || '').replace(/\/+$/, '');
  }

  private get creds(): string {
    return `username=${encodeURIComponent(this.src.username || '')}&password=${encodeURIComponent(this.src.password || '')}`;
  }

  apiUrl(action?: string, extra = ''): string {
    return `${this.base}/player_api.php?${this.creds}${action ? `&action=${action}` : ''}${extra}`;
  }

  async api(action?: string, extra = ''): Promise<Json> {
    const text = await this.fetchText(this.apiUrl(action, extra), this.src.userAgent);
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Provider returned an invalid response for ${action || 'login'}`);
    }
  }

  private path(type: string, id: number | string, ext: string): string {
    const u = encodeURIComponent(this.src.username || '');
    const p = encodeURIComponent(this.src.password || '');
    return `${this.base}/${type}/${u}/${p}/${id}.${ext}`;
  }

  liveUrl(id: number, format: 'ts' | 'm3u8'): string {
    return this.path('live', id, format);
  }
  movieUrl(id: number, ext = 'mp4'): string {
    return this.path('movie', id, ext);
  }
  episodeUrl(id: number | string, ext = 'mp4'): string {
    return this.path('series', id, ext);
  }

  async login(): Promise<AccountInfo> {
    const r = await this.api();
    const ui = r && r.user_info;
    if (!ui || String(ui.auth) === '0') throw new Error('Login failed: check server, username and password');
    return {
      status: str(ui.status),
      expires: ui.exp_date ? Number(ui.exp_date) * 1000 : undefined,
      maxConnections: ui.max_connections ? Number(ui.max_connections) : undefined,
      activeConnections: ui.active_cons ? Number(ui.active_cons) : undefined,
    };
  }

  async loadLibrary(playlistId: string): Promise<Library> {
    const account = await this.login();
    const arr = (x: Json) => (Array.isArray(x) ? x : x && typeof x === 'object' ? Object.values(x) : []);
    const [lc, ls, vc, vs, sc, ss] = await Promise.all([
      this.api('get_live_categories').then(arr),
      this.api('get_live_streams').then(arr),
      this.api('get_vod_categories').then(arr).catch(() => []),
      this.api('get_vod_streams').then(arr).catch(() => []),
      this.api('get_series_categories').then(arr).catch(() => []),
      this.api('get_series').then(arr).catch(() => []),
    ]);

    const categories: Category[] = [];
    const known = new Set<string>();
    const addCats = (kind: Kind, list: Json[]) => {
      for (const c of list) {
        const id = `c.${kind}:${c.category_id}`;
        if (known.has(id)) continue;
        known.add(id);
        categories.push({ id, name: String(c.category_name || 'Unnamed'), kind });
      }
    };
    addCats('live', lc);
    addCats('movie', vc);
    addCats('series', sc);

    const items: Item[] = [];
    const catFor = (kind: Kind, cid: unknown): string => {
      const id = `c.${kind}:${cid ?? 'none'}`;
      if (!known.has(id)) {
        known.add(id);
        categories.push({ id, name: 'Uncategorized', kind });
      }
      return id;
    };

    for (const s of ls) {
      const xid = Number(s.stream_id);
      items.push({
        id: `live:${xid}`, kind: 'live', xid,
        name: String(s.name ?? ''),
        categoryId: catFor('live', s.category_id),
        logo: str(s.stream_icon),
        epgId: str(s.epg_channel_id),
      });
    }
    for (const s of vs) {
      const xid = Number(s.stream_id);
      items.push({
        id: `movie:${xid}`, kind: 'movie', xid,
        name: String(s.name ?? ''),
        categoryId: catFor('movie', s.category_id),
        logo: str(s.stream_icon),
        ext: str(s.container_extension) || 'mp4',
        rating: str(s.rating),
        year: yearOf(s.year ?? s.releaseDate ?? s.release_date),
        added: s.added ? Number(s.added) : undefined,
      });
    }
    for (const s of ss) {
      const xid = Number(s.series_id);
      items.push({
        id: `series:${xid}`, kind: 'series', xid,
        name: String(s.name ?? ''),
        categoryId: catFor('series', s.category_id),
        logo: str(s.cover),
        rating: str(s.rating),
        year: yearOf(s.releaseDate ?? s.release_date ?? s.year),
        plot: str(s.plot),
      });
    }
    return { playlistId, loadedAt: Date.now(), categories, items, account };
  }

  async seriesInfo(seriesId: number): Promise<SeriesInfo> {
    const r = await this.api('get_series_info', `&series_id=${seriesId}`);
    const info = (r && r.info) || {};
    const episodes: Episode[] = [];
    const raw = (r && r.episodes) || {};
    const groups: Json[][] = Array.isArray(raw) ? raw : Object.values(raw);
    for (const g of groups) {
      for (const e of Array.isArray(g) ? g : [g]) {
        if (!e) continue;
        const season = Number(e.season ?? 1) || 1;
        episodes.push({
          id: `ep:${e.id}`,
          title: String(e.title || `Episode ${e.episode_num}`),
          season,
          episode: Number(e.episode_num) || episodes.length + 1,
          url: this.episodeUrl(e.id, e.container_extension || 'mp4'),
          logo: str(e.info?.movie_image),
          plot: str(e.info?.plot),
          duration: str(e.info?.duration),
        });
      }
    }
    episodes.sort((a, b) => a.season - b.season || a.episode - b.episode);
    const seasons = [...new Set(episodes.map((e) => e.season))];
    return {
      plot: str(info.plot),
      cover: str(info.cover),
      genre: str(info.genre),
      cast: str(info.cast),
      rating: str(info.rating),
      year: yearOf(info.releaseDate ?? info.release_date),
      seasons,
      episodes,
    };
  }

  async movieInfo(vodId: number): Promise<MovieInfo> {
    const r = await this.api('get_vod_info', `&vod_id=${vodId}`);
    const i = (r && r.info) || {};
    return {
      plot: str(i.plot ?? i.description),
      cover: str(i.movie_image ?? i.cover_big),
      genre: str(i.genre),
      cast: str(i.cast ?? i.actors),
      director: str(i.director),
      rating: str(i.rating),
      year: yearOf(i.releasedate ?? i.release_date ?? i.year),
      duration: str(i.duration),
    };
  }

  async shortEpg(streamId: number, limit = 2): Promise<{ title: string; start: number; end: number }[]> {
    const r = await this.api('get_short_epg', `&stream_id=${streamId}&limit=${limit}`);
    const list: Json[] = (r && r.epg_listings) || [];
    const b64 = (s: string) => {
      try {
        return decodeURIComponent(escape(atob(s)));
      } catch {
        return s;
      }
    };
    return list.map((e) => ({
      title: b64(String(e.title || '')),
      start: Number(e.start_timestamp) * 1000,
      end: Number(e.stop_timestamp) * 1000,
    }));
  }
}
