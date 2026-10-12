/**
 * Incremental XMLTV parser. Feed it text chunks as they stream in; it emits
 * <channel> and <programme> elements without ever holding the whole file
 * (provider guides are often 50–300 MB).
 */

/** [start, stop] in epoch seconds, title, description */
export type Prog = [number, number, string, string];

export interface XmltvHandlers {
  channel(id: string, names: string[]): void;
  programme(channelId: string, start: number, stop: number, title: string, desc: string): void;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXml(s: string): string {
  if (s.startsWith('<![CDATA[')) return s.slice(9, s.endsWith(']]>') ? -3 : undefined);
  if (s.indexOf('&') === -1) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** "20261012060000 +0200" -> epoch seconds (UTC when no offset is given). */
export function parseXmltvTime(s: string | undefined): number {
  if (!s) return NaN;
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{2}:?\d{2})?/.exec(s.trim());
  if (!m) return NaN;
  let t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) / 1000;
  if (m[7]) {
    const o = m[7].replace(':', '');
    const mins = parseInt(o.slice(1, 3), 10) * 60 + parseInt(o.slice(3, 5), 10);
    t -= (o[0] === '-' ? -1 : 1) * mins * 60;
  }
  return t;
}

const reCache = new Map<string, RegExp>();
function re(key: string, src: () => string, flags = ''): RegExp {
  let r = reCache.get(key + flags);
  if (!r) reCache.set(key + flags, (r = new RegExp(src(), flags)));
  return r;
}

function attr(tag: string, name: string): string | undefined {
  const m = re('a:' + name, () => `\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(tag);
  return m ? decodeXml(m[1] ?? m[2]) : undefined;
}

const elementSrc = (tag: string) => () => `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`;

function firstText(body: string, tag: string): string {
  const m = re('e:' + tag, elementSrc(tag)).exec(body);
  return m ? decodeXml(m[1].trim()) : '';
}

function allText(body: string, tag: string): string[] {
  const out: string[] = [];
  const re2 = re('e:' + tag, elementSrc(tag), 'g');
  re2.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re2.exec(body))) out.push(decodeXml(m[1].trim()));
  return out;
}

export class XmltvParser {
  private buf = '';
  constructor(private h: XmltvHandlers, private maxDesc = 400) {}

  push(chunk: string) {
    this.buf += chunk;
    let pos = 0;
    const b = this.buf;
    for (;;) {
      const p = b.indexOf('<programme', pos);
      const c = b.indexOf('<channel', pos);
      if (p === -1 && c === -1) {
        // Keep a short tail in case a start tag is split across chunks.
        pos = Math.max(pos, b.length - 12);
        break;
      }
      const isProg = p !== -1 && (c === -1 || p < c);
      const start = isProg ? p : c;
      const close = isProg ? '</programme>' : '</channel>';
      const tagEnd = b.indexOf('>', start);
      if (tagEnd === -1) { pos = start; break; }
      const openTag = b.slice(start, tagEnd + 1);
      let end: number;
      let body: string;
      if (openTag.endsWith('/>')) {
        end = tagEnd + 1;
        body = '';
      } else {
        const e = b.indexOf(close, tagEnd);
        if (e === -1) { pos = start; break; }
        end = e + close.length;
        body = b.slice(tagEnd + 1, e);
      }
      pos = end;
      if (isProg) {
        const ch = attr(openTag, 'channel');
        const s = parseXmltvTime(attr(openTag, 'start'));
        const st = parseXmltvTime(attr(openTag, 'stop'));
        if (ch && isFinite(s)) {
          let desc = firstText(body, 'desc');
          if (desc.length > this.maxDesc) desc = desc.slice(0, this.maxDesc - 1) + '…';
          this.h.programme(ch, s, isFinite(st) ? st : s + 1800, firstText(body, 'title'), desc);
        }
      } else {
        const id = attr(openTag, 'id');
        if (id) this.h.channel(id, allText(body, 'display-name'));
      }
    }
    this.buf = b.slice(pos);
  }
}

/**
 * Loose channel-name key used to match playlist channels to guide channels
 * when ids differ: "UK| BBC One HD" ≈ "BBC One".
 */
export function normName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^[a-z]{2,3}\s*[|:\-]\s*/, '') // country prefix "UK|", "US: "
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ') // [UK], (backup)
    .replace(/\b(fhd|uhd|hd|sd|4k|hevc|h265|1080p?|720p?|50fps|60fps)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '');
}
