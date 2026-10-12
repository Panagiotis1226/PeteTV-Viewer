import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Logo } from '../components/Logo';
import { VirtualList } from '../components/VirtualList';
import { airingIndex, ensureEpg, fmtClock, programmesFor, refreshEpg } from '../epg';
import type { Prog } from '../epg/xmltv';
import { focusDefault, focusEl } from '../nav/spatial';
import { pop } from '../router';
import { allItems, categoriesFor, getItem, itemsFor, state, useStore } from '../store';
import type { Item } from '../types';
import { playLive } from './common';

const SLOT = 1800; // 30 minutes
/** Visible time window: 2h on TVs/desktops, 1h on phones. */
const spanFor = () => (typeof window !== 'undefined' && window.innerWidth < 760 ? 3600 : 2 * 3600);
const ALL = '__all';
const FAV = '__fav';

const floorSlot = (t: number) => Math.floor(t / SLOT) * SLOT;
const nowSec = () => Date.now() / 1000;

function useNow() {
  const [t, setT] = useState(nowSec());
  useEffect(() => {
    const i = setInterval(() => setT(nowSec()), 30000);
    return () => clearInterval(i);
  }, []);
  return t;
}

/** Programme overlapping time t in a sorted list, or the nearest one. */
function pickAt(list: Prog[] | undefined, t: number): Prog | undefined {
  if (!list || !list.length) return undefined;
  const i = airingIndex(list, t);
  if (i >= 0) return list[i];
  return list.find((p) => p[0] >= t) || list[list.length - 1];
}

interface Sel { row: number; start: number }

export function Guide() {
  const s = useStore();
  const now = useNow();
  const [catId, setCatId] = useState(ALL);
  const [winStart, setWinStart] = useState(() => floorSlot(nowSec()) - SLOT);
  const [sel, setSel] = useState<Sel | null>(null);
  const [detail, setDetail] = useState<{ row: number; prog: Prog } | null>(null);
  const pending = useRef<Sel | null>(null);
  const [SPAN, setSpan] = useState(spanFor);
  useEffect(() => {
    const onResize = () => setSpan(spanFor());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const winEnd = winStart + SPAN;
  const minStart = floorSlot(now) - 3 * 3600;

  useEffect(() => { ensureEpg({ network: true }); }, []);

  // Details popup: focus its button, Back closes it, then return focus to the programme.
  // Layout effect = runs right after render, so a Back pressed immediately after OK is caught.
  useLayoutEffect(() => {
    if (!detail) return;
    focusDefault();
    const onKey = (e: KeyboardEvent) => {
      if (['Escape', 'Backspace', 'GoBack', 'BrowserBack'].includes(e.key)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        closeDetail();
      }
    };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('petetv-back', closeDetail);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('petetv-back', closeDetail);
    };
  }, [detail]);

  const closeDetail = () => {
    if (!detail) return;
    const { row, prog } = detail;
    setDetail(null);
    pending.current = { row, start: prog[0] };
  };

  const cats = useMemo(() => categoriesFor('live'), [s.library, s.prefs]);
  const channels: Item[] = useMemo(() => {
    if (catId === ALL) return allItems('live');
    if (catId === FAV) return s.prefs.favorites.map(getItem).filter((i): i is Item => !!i && i.kind === 'live');
    return itemsFor(catId);
  }, [catId, s.library, s.prefs]);

  // Move focus right after the window shifted / rows re-rendered (synchronously, so
  // fast key repeats from a held remote button land on the new element).
  useLayoutEffect(() => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    const el = document.querySelector<HTMLElement>(`.g-prog[data-row="${p.row}"][data-start="${p.start}"]`);
    if (el) focusEl(el);
  });

  const focusProg = (row: number, start: number, newWin?: number) => {
    pending.current = { row, start };
    if (newWin !== undefined && newWin !== winStart) setWinStart(newWin);
    else setSel({ row, start }); // force a render so the effect runs
  };

  /** Pick the programme to land on in `row` when moving vertically / from the channel column. */
  const landing = (row: number, t: number): number => {
    const list = programmesFor(channels[row]);
    const p = pickAt(list?.filter((x) => x[1] > winStart && x[0] < winEnd), t);
    return p ? p[0] : -1;
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement;
    const isProg = el.classList.contains('g-prog');
    if (!isProg && !el.classList.contains('g-ch')) return;
    const row = Number(el.dataset.row);
    const handled = () => { e.preventDefault(); e.stopPropagation(); };

    if (!isProg) {
      if (e.key === 'ArrowRight') {
        handled();
        focusProg(row, landing(row, Math.max(now, winStart)));
      }
      return; // up/down/left in the channel column: normal navigation
    }

    const start = Number(el.dataset.start);
    const list = programmesFor(channels[row]) || [];
    const idx = list.findIndex((p) => p[0] === start);
    const cursor = start < 0 ? Math.max(now, winStart) : Math.max(start, winStart);

    switch (e.key) {
      case 'ArrowRight': {
        handled();
        const next = idx >= 0 ? list[idx + 1] : undefined;
        if (next) focusProg(row, next[0], next[0] >= winEnd ? floorSlot(next[0]) : winStart);
        else if (winEnd < now + 47 * 3600) setWinStart(winStart + SLOT); // empty / last: just scroll time
        break;
      }
      case 'ArrowLeft': {
        handled();
        const prev = idx > 0 ? list[idx - 1] : undefined;
        if (prev && prev[1] > minStart) {
          focusProg(row, prev[0], prev[1] <= winStart ? Math.max(minStart, floorSlot(prev[1] - 1) - SPAN + SLOT) : winStart);
        } else if (winStart > minStart && (start < 0 || start < winStart)) {
          setWinStart(Math.max(minStart, winStart - SLOT));
        } else {
          const ch = el.closest('.g-row')?.querySelector<HTMLElement>('.g-ch');
          if (ch) focusEl(ch);
        }
        break;
      }
      case 'ArrowUp':
      case 'ArrowDown': {
        const r = row + (e.key === 'ArrowUp' ? -1 : 1);
        if (r < 0) return; // let normal navigation move up to the toolbar
        handled();
        if (r < channels.length) focusProg(r, landing(r, cursor));
        break;
      }
      default:
    }
  };

  const open = (row: number, prog?: Prog) => {
    if (!prog || (prog[0] <= now && now < prog[1])) playLive(channels, row);
    else setDetail({ row, prog });
  };

  const selItem = sel ? channels[sel.row] : undefined;
  const selProg = sel && selItem ? (programmesFor(selItem) || []).find((p) => p[0] === sel.start) : undefined;
  const frac = (t: number) => (t - winStart) / SPAN;
  const slots = [];
  for (let t = winStart; t < winEnd; t += SLOT) slots.push(t);
  const nowFrac = frac(now);

  const day = new Date(winStart * 1000).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });

  return (
    <div class="screen guide">
      <header class="topbar">
        <button data-nav class="btn ghost" onClick={() => pop()} aria-label="Back">←</button>
        <h1>TV Guide</h1>
        <select data-nav class="g-cat" value={catId} onChange={(e) => { setCatId((e.currentTarget as HTMLSelectElement).value); setSel(null); }} aria-label="Category">
          <option value={ALL}>All channels</option>
          <option value={FAV}>★ Favorites</option>
          {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div class="grow" />
        <span class="muted">{day}</span>
        <button data-nav class="btn" disabled={winStart <= minStart} onClick={() => setWinStart(Math.max(minStart, winStart - SPAN / 2))}>◀ Earlier</button>
        <button data-nav class="btn" onClick={() => setWinStart(floorSlot(now) - SLOT)}>Now</button>
        <button data-nav class="btn" onClick={() => setWinStart(winStart + SPAN / 2)}>Later ▶</button>
        <button data-nav class="btn" disabled={!!s.epgStatus} onClick={() => refreshEpg()}>⟳ Update guide</button>
      </header>

      {s.epgStatus && <div class="banner">{s.epgStatus}</div>}
      {s.epgError && !s.epgStatus && (
        <div class="banner error">{s.epgError} <button data-nav class="btn sm" onClick={() => refreshEpg()}>Retry</button></div>
      )}

      <div class="g-info">
        {selItem ? (
          <>
            <Logo src={selItem.logo} name={selItem.name} class="g-info-logo" />
            <div class="g-info-text">
              <div class="muted small">{selItem.name}</div>
              <h2>{selProg ? selProg[2] || 'Untitled' : 'No programme information'}</h2>
              {selProg && (
                <div class="muted small">
                  {fmtClock(selProg[0])} – {fmtClock(selProg[1])}
                  {selProg[0] <= now && now < selProg[1] && <span class="live-badge">LIVE</span>}
                </div>
              )}
              {selProg?.[3] && <p class="g-desc">{selProg[3]}</p>}
            </div>
          </>
        ) : (
          <p class="muted">Use the arrows to browse. OK on a programme that is on now starts the channel.</p>
        )}
      </div>

      <div class="g-grid" onKeyDown={onKeyDown}>
        <div class="g-ruler">
          <div class="g-ruler-ch" />
          <div class="g-ruler-time">
            {slots.map((t) => (
              <span key={t} style={{ left: `${frac(t) * 100}%` }}>{fmtClock(t)}</span>
            ))}
          </div>
        </div>
        <div class="g-body" data-nav-group="guide">
          {nowFrac > 0 && nowFrac < 1 && <div class="g-now" style={{ left: `calc(var(--g-ch) + (100% - var(--g-ch)) * ${nowFrac})` }} />}
          {channels.length === 0 ? (
            <div class="empty">No channels in this category</div>
          ) : (
            <VirtualList
              items={channels}
              rowRem={4.6}
              resetKey={catId}
              getKey={(it) => it.id}
              render={(it, row) => {
                const list = programmesFor(it);
                const visible = list ? list.filter((p) => p[1] > winStart && p[0] < winEnd) : [];
                return (
                  <div class="g-row">
                    <button data-nav class="g-ch" data-row={row} onClick={() => open(row)} onFocus={() => setSel({ row, start: -1 })}>
                      <span class="ch-num">{row + 1}</span>
                      <Logo src={it.logo} name={it.name} class="g-ch-logo" />
                      <span class="g-ch-name">{it.name}</span>
                    </button>
                    <div class="g-line">
                      {visible.length ? visible.map((p) => {
                        const a = Math.max(p[0], winStart);
                        const b = Math.min(p[1], winEnd);
                        const live = p[0] <= now && now < p[1];
                        return (
                          <button
                            key={p[0]}
                            data-nav
                            class={'g-prog' + (live ? ' live' : '') + (p[1] <= now ? ' past' : '')}
                            data-row={row}
                            data-start={p[0]}
                            style={{ left: `${frac(a) * 100}%`, width: `${((b - a) / SPAN) * 100}%` }}
                            onFocus={() => setSel({ row, start: p[0] })}
                            onClick={() => open(row, p)}
                          >
                            <span class="g-title">{p[0] < winStart ? '‹ ' : ''}{p[2] || 'Untitled'}</span>
                            <span class="g-time">{fmtClock(p[0])}</span>
                          </button>
                        );
                      }) : (
                        <button
                          data-nav
                          class="g-prog empty"
                          data-row={row}
                          data-start={-1}
                          style={{ left: '0%', width: '100%' }}
                          onFocus={() => setSel({ row, start: -1 })}
                          onClick={() => open(row)}
                        >
                          <span class="g-title">{state.epg ? 'No programme information' : s.epgStatus ? 'Loading guide…' : 'No guide loaded'}</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              }}
            />
          )}
        </div>
      </div>

      {detail && (
        <div class="modal" data-nav-scope>
          <div class="modal-box">
            <div class="muted small">{channels[detail.row]?.name}</div>
            <h2>{detail.prog[2] || 'Untitled'}</h2>
            <div class="muted">
              {new Date(detail.prog[0] * 1000).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}
              {' · '}{fmtClock(detail.prog[0])} – {fmtClock(detail.prog[1])}
            </div>
            {detail.prog[3] && <p class="plot">{detail.prog[3]}</p>}
            <div class="row gap">
              <button data-nav data-nav-default class="btn primary" onClick={() => { const r = detail.row; setDetail(null); playLive(channels, r); }}>▶ Watch channel now</button>
              <button data-nav class="btn" onClick={closeDetail}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
