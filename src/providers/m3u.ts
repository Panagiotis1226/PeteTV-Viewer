import { classify, parseEpisodeName, parseM3U } from '../parsers/m3u';
import type { Category, Episode, Item, Kind, Library } from '../types';
import { hash } from '../util';

/** Build a normalized library from raw M3U text. */
export function buildM3ULibrary(playlistId: string, text: string): Library {
  const { entries, epgUrl } = parseM3U(text);
  const categories: Category[] = [];
  const catSeen = new Set<string>();
  const items: Item[] = [];
  const idSeen = new Map<string, number>();
  const seriesById = new Map<string, Item>();
  const episodes: Record<string, Episode[]> = {};

  const cat = (kind: Kind, group: string): string => {
    const id = `c.${kind}:${hash(group)}`;
    if (!catSeen.has(id)) {
      catSeen.add(id);
      categories.push({ id, name: group, kind });
    }
    return id;
  };
  const uniq = (base: string): string => {
    const n = idSeen.get(base) || 0;
    idSeen.set(base, n + 1);
    return n ? `${base}~${n}` : base;
  };

  for (const e of entries) {
    const kind = classify(e);
    if (kind === 'series') {
      const ep = parseEpisodeName(e.name);
      const show = ep ? ep.show : e.name;
      const categoryId = cat('series', e.group);
      const sid = `series:${hash(e.group + '|' + show)}`;
      let s = seriesById.get(sid);
      if (!s) {
        s = { id: sid, kind: 'series', name: show, categoryId, logo: e.logo };
        seriesById.set(sid, s);
        items.push(s);
        episodes[sid] = [];
      }
      const list = episodes[sid];
      list.push({
        id: uniq(`ep:${hash(e.url)}`),
        title: e.name,
        season: ep ? ep.season : 1,
        episode: ep ? ep.episode : list.length + 1,
        url: e.url,
        logo: e.logo,
      });
      continue;
    }
    const categoryId = cat(kind, e.group);
    items.push({
      id: uniq(`${kind}:${hash(e.group + '|' + e.name)}`),
      kind,
      name: e.name,
      categoryId,
      logo: e.logo,
      url: e.url,
      epgId: e.tvgId,
    });
  }
  for (const id in episodes) {
    episodes[id].sort((a, b) => a.season - b.season || a.episode - b.episode);
  }
  return { playlistId, loadedAt: Date.now(), categories, items, episodes, epgUrl };
}
