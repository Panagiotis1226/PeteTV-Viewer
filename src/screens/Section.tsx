import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Logo } from '../components/Logo';
import { VirtualGrid, VirtualList } from '../components/VirtualList';
import { push, pop } from '../router';
import {
  allItems, categoriesFor, getItem, historyFor, isFavorite, itemsFor, state, toggleFavorite, useStore, xtreamFor,
} from '../store';
import type { Item, Kind } from '../types';
import { norm } from '../util';
import { playLive } from './common';

const TITLES: Record<Kind, string> = { live: 'Live TV', movie: 'Movies', series: 'Series' };
const ALL = '__all';
const FAV = '__fav';
const RECENT = '__recent';

function useEpg(it: Item | null) {
  const [epg, setEpg] = useState<string | null>(null);
  useEffect(() => {
    setEpg(null);
    const x = xtreamFor();
    if (!it || it.kind !== 'live' || !x || it.xid === undefined) return;
    const t = setTimeout(() => {
      x.shortEpg(it.xid!, 2).then((l) => {
        if (!l.length) return;
        const fmt = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        setEpg(l.map((e) => `${fmt(e.start)}  ${e.title}`).join('\n'));
      }).catch(() => {});
    }, 600);
    return () => clearTimeout(t);
  }, [it?.id]);
  return epg;
}

export function Section({ kind }: { kind: Kind }) {
  const s = useStore();
  const cats = useMemo(() => categoriesFor(kind), [s.library, s.prefs]);
  const [catId, setCatId] = useState<string>(ALL);
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState<Item | null>(null);
  const catTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const items = useMemo(() => {
    let list: Item[];
    if (query.trim()) {
      const q = norm(query.trim());
      list = allItems(kind).filter((i) => norm(i.name).includes(q));
    } else if (catId === ALL) list = allItems(kind);
    else if (catId === FAV) list = s.prefs.favorites.map(getItem).filter((i): i is Item => !!i && i.kind === kind);
    else if (catId === RECENT) {
      const seen = new Set<string>();
      list = [];
      for (const h of historyFor(kind)) {
        const it = getItem(h.seriesId || h.id);
        if (it && !seen.has(it.id)) { seen.add(it.id); list.push(it); }
      }
    } else list = itemsFor(catId);
    return list;
  }, [catId, query, s.library, s.prefs]);

  const epg = useEpg(kind === 'live' ? focused : null);

  /** Focus previews a category (debounced); clicking/OK selects it and leaves search. */
  const selectCat = (id: string, immediate = false) => {
    clearTimeout(catTimer.current);
    if (immediate) {
      setCatId(id);
      setQuery('');
    } else if (!query) {
      catTimer.current = setTimeout(() => setCatId(id), 180);
    }
  };

  const specials = [
    { id: ALL, name: 'All', count: undefined as number | undefined },
    { id: FAV, name: '★ Favorites', count: undefined },
    { id: RECENT, name: kind === 'live' ? '⟲ Recently watched' : '⟲ Continue watching', count: undefined },
  ];
  const catList = [...specials, ...cats.map((c) => ({ id: c.id, name: c.name, count: itemsFor(c.id).length }))];

  const open = (it: Item, index: number) => {
    if (kind === 'live') playLive(items, index);
    else push({ name: kind === 'movie' ? 'movie' : 'series', id: it.id });
  };

  return (
    <div class="screen section">
      <header class="topbar">
        <button data-nav class="btn ghost" onClick={() => pop()} aria-label="Back">←</button>
        <h1>{TITLES[kind]}</h1>
        <div class="grow" />
        <input
          data-nav
          class="search"
          type="search"
          placeholder={`Search ${TITLES[kind].toLowerCase()}…`}
          value={query}
          onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
        />
        <button data-nav class="btn" onClick={() => push({ name: 'manage', kind })}>☰ Edit</button>
      </header>
      <div class="split">
        <nav class="cats" data-nav-group="cats">
          <VirtualList
            items={catList}
            rowRem={3.2}
            getKey={(c) => c.id}
            render={(c) => (
              <button
                data-nav
                data-nav-default={c.id === catId ? '' : undefined}
                data-nav-active={c.id === catId ? '' : undefined}
                class={'cat' + (c.id === catId && !query ? ' active' : '')}
                onFocus={() => selectCat(c.id)}
                onClick={() => selectCat(c.id, true)}
              >
                <span class="cat-name">{c.name}</span>
                {c.count !== undefined && <span class="cat-count">{c.count}</span>}
              </button>
            )}
          />
        </nav>
        <main key={catId + '|' + query} class="content" data-nav-group="items" data-nav-enter="first">
          {items.length === 0 ? (
            <div class="empty">{query ? 'No results' : catId === FAV ? 'No favorites yet — press ★ on anything to add it.' : 'Nothing here'}</div>
          ) : kind === 'live' ? (
            <VirtualList
              items={items}
              rowRem={4}
              resetKey={catId + query}
              getKey={(i) => i.id}
              render={(it, i) => (
                <div class="ch-row">
                  <button data-nav class="ch" onClick={() => open(it, i)} onFocus={() => setFocused(it)}>
                    <span class="ch-num">{i + 1}</span>
                    <Logo src={it.logo} name={it.name} class="ch-logo" />
                    <span class="ch-name">{it.name}</span>
                  </button>
                  <button data-nav class={'fav' + (isFavorite(it.id) ? ' on' : '')} onClick={() => toggleFavorite(it.id)} aria-label="Favorite">★</button>
                </div>
              )}
            />
          ) : (
            <VirtualGrid
              items={items}
              cellRem={10}
              cellHeightRem={17.5}
              resetKey={catId + query}
              getKey={(i) => i.id}
              render={(it, i) => (
                <button data-nav class="poster" onClick={() => open(it, i)} onFocus={() => setFocused(it)}>
                  <Logo src={it.logo} name={it.name} class="poster-img" />
                  {isFavorite(it.id) && <span class="poster-fav">★</span>}
                  {it.rating && Number(it.rating) > 0 ? <span class="poster-rating">{Number(it.rating).toFixed(1)}</span> : null}
                  <span class="poster-title">{it.name}</span>
                </button>
              )}
            />
          )}
        </main>
        {kind === 'live' && focused && (
          <aside class="info">
            <Logo src={focused.logo} name={focused.name} class="info-logo" />
            <h3>{focused.name}</h3>
            {epg ? <pre class="epg">{epg}</pre> : <p class="muted small">{state.library && xtreamFor() ? 'No programme info' : ''}</p>}
          </aside>
        )}
      </div>
    </div>
  );
}
