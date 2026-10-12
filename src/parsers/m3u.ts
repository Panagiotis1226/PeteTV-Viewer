/** Minimal, fast M3U / M3U8 (IPTV flavoured) parser. */

export interface M3UEntry {
  name: string;
  url: string;
  group: string;
  logo?: string;
  tvgId?: string;
  tvgName?: string;
  userAgent?: string;
}

export interface M3UResult {
  entries: M3UEntry[];
  epgUrl?: string;
}

const ATTR_RE = /([A-Za-z0-9_-]+)="([^"]*)"/g;

function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(s))) out[m[1].toLowerCase()] = m[2];
  return out;
}

/** Index of the first comma that is not inside double quotes. */
function titleComma(s: string): number {
  let inQ = false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 34) inQ = !inQ;
    else if (c === 44 && !inQ) return i;
  }
  return -1;
}

export function parseM3U(text: string): M3UResult {
  const entries: M3UEntry[] = [];
  let epgUrl: string | undefined;
  let pending: Partial<M3UEntry> | null = null;
  let pendingGroup: string | undefined;
  let pendingUA: string | undefined;

  // Strip BOM
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  let start = 0;
  const len = text.length;
  while (start < len) {
    let end = text.indexOf('\n', start);
    if (end === -1) end = len;
    let line = text.slice(start, end);
    start = end + 1;
    if (line.endsWith('\r')) line = line.slice(0, -1);
    line = line.trim();
    if (!line) continue;

    if (line.charCodeAt(0) === 35 /* # */) {
      if (line.startsWith('#EXTINF')) {
        const body = line.slice(line.indexOf(':') + 1);
        const comma = titleComma(body);
        const attrPart = comma === -1 ? body : body.slice(0, comma);
        const title = comma === -1 ? '' : body.slice(comma + 1).trim();
        const a = parseAttrs(attrPart);
        pending = {
          name: title || a['tvg-name'] || '',
          group: a['group-title'] || '',
          logo: a['tvg-logo'] || a['logo'] || undefined,
          tvgId: a['tvg-id'] || undefined,
          tvgName: a['tvg-name'] || undefined,
        };
        pendingGroup = undefined;
      } else if (line.startsWith('#EXTGRP:')) {
        pendingGroup = line.slice(8).trim();
      } else if (line.startsWith('#EXTVLCOPT:')) {
        const opt = line.slice(11);
        if (opt.toLowerCase().startsWith('http-user-agent=')) pendingUA = opt.slice(16);
      } else if (line.startsWith('#EXTM3U')) {
        const a = parseAttrs(line);
        epgUrl = a['url-tvg'] || a['x-tvg-url'] || epgUrl;
      }
      continue;
    }

    // URL line
    const p: Partial<M3UEntry> = pending || { name: '', group: '' };
    const entry: M3UEntry = {
      name: p.name || p.tvgName || line.split('/').pop() || 'Untitled',
      url: line,
      group: p.group || pendingGroup || 'Uncategorized',
    };
    if (p.logo) entry.logo = p.logo;
    if (p.tvgId) entry.tvgId = p.tvgId;
    if (p.tvgName) entry.tvgName = p.tvgName;
    if (pendingUA) entry.userAgent = pendingUA;
    entries.push(entry);
    pending = null;
    pendingGroup = undefined;
    pendingUA = undefined;
  }
  return { entries, epgUrl };
}

const VOD_EXT = /\.(mp4|mkv|avi|mov|m4v|wmv|flv|webm|mpg|mpeg|divx)(\?|$)/i;
const SXXEXX = /^(.*?)[\s._\-|:]*\bS(\d{1,2})[\s._-]*E(\d{1,4})\b/i;

export type EntryKind = 'live' | 'movie' | 'series';

/** Classify an entry as live TV, a movie or a series episode. */
export function classify(e: M3UEntry): EntryKind {
  const u = e.url.toLowerCase();
  if (u.includes('/series/')) return 'series';
  if (u.includes('/movie/')) return SXXEXX.test(e.name) ? 'series' : 'movie';
  if (VOD_EXT.test(u)) return SXXEXX.test(e.name) ? 'series' : 'movie';
  return 'live';
}

/** "Show Name S01 E02 - Title" -> { show, season, episode } */
export function parseEpisodeName(name: string): { show: string; season: number; episode: number } | null {
  const m = SXXEXX.exec(name);
  if (!m) return null;
  const show = m[1].replace(/[\s._\-|:]+$/, '').trim();
  return { show: show || name, season: parseInt(m[2], 10), episode: parseInt(m[3], 10) };
}
