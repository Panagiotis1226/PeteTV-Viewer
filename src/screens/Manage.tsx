import { useMemo } from 'preact/hooks';
import { VirtualList } from '../components/VirtualList';
import { focusEl } from '../nav/spatial';
import { push, pop, replace } from '../router';
import {
  categoriesFor, itemsFor, moveCategory, moveItem, resetOrder, state, toggleHiddenCategory, toggleHiddenItem, useStore,
} from '../store';
import type { Kind } from '../types';

const LABEL: Record<Kind, string> = { live: 'Live TV', movie: 'Movies', series: 'Series' };

/** Keep the pressed button focused & visible after its row moved. */
function refocus(e: Event) {
  const btn = e.currentTarget as HTMLElement;
  requestAnimationFrame(() => focusEl(btn));
}

interface RowProps {
  name: string;
  sub?: string;
  hidden: boolean;
  index: number;
  total: number;
  onToggle: () => void;
  onMove: (d: number) => void;
  onOpen?: () => void;
}

function ManageRow({ name, sub, hidden, index, total, onToggle, onMove, onOpen }: RowProps) {
  return (
    <div class={'mrow' + (hidden ? ' is-hidden' : '')}>
      <span class="mrow-pos">{index + 1}</span>
      <span class="mrow-name">
        {name}
        {sub && <small> {sub}</small>}
      </span>
      <button data-nav class={'btn sm toggle' + (hidden ? '' : ' on')} onClick={onToggle} aria-pressed={!hidden}>
        {hidden ? '🚫 Hidden' : '👁 Visible'}
      </button>
      <button data-nav class="btn sm" disabled={index === 0} onClick={(e) => { onMove(-1); refocus(e); }} aria-label="Move up">▲</button>
      <button data-nav class="btn sm" disabled={index === total - 1} onClick={(e) => { onMove(1); refocus(e); }} aria-label="Move down">▼</button>
      <button data-nav class="btn sm" disabled={index === 0} onClick={(e) => { onMove(-index); refocus(e); }} aria-label="Move to top">⤒</button>
      {onOpen && <button data-nav class="btn sm" onClick={onOpen}>Channels ›</button>}
    </div>
  );
}

export function Manage({ kind }: { kind: Kind }) {
  const s = useStore();
  const cats = useMemo(() => categoriesFor(kind, true), [s.library, s.prefs]);
  const hidden = new Set(s.prefs.hiddenCategories);
  return (
    <div class="screen manage">
      <header class="topbar">
        <button data-nav class="btn ghost" onClick={() => pop()} aria-label="Back">←</button>
        <h1>Hide &amp; reorder</h1>
        <div class="seg">
          {(['live', 'movie', 'series'] as Kind[]).map((k) => (
            <button key={k} data-nav class={'pill' + (k === kind ? ' active' : '')} onClick={() => replace({ name: 'manage', kind: k })}>
              {LABEL[k]}
            </button>
          ))}
        </div>
        <div class="grow" />
        <button data-nav class="btn" onClick={() => { if (confirm(`Reset hidden items and order for ${LABEL[kind]}?`)) resetOrder(kind); }}>Reset</button>
      </header>
      <p class="muted small pad">
        Hide categories you never watch and move favourites to the top. Changes apply to the {LABEL[kind]} screen instantly.
        {' '}{cats.length - cats.filter((c) => hidden.has(c.id)).length} of {cats.length} categories visible.
      </p>
      <div class="manage-list" data-nav-group="manage">
        <VirtualList
          items={cats}
          rowRem={4}
          getKey={(c) => c.id}
          render={(c, i) => (
            <ManageRow
              name={c.name}
              sub={`(${itemsFor(c.id, true).length})`}
              hidden={hidden.has(c.id)}
              index={i}
              total={cats.length}
              onToggle={() => toggleHiddenCategory(c.id)}
              onMove={(d) => moveCategory(kind, c.id, d)}
              onOpen={() => push({ name: 'manageItems', categoryId: c.id })}
            />
          )}
        />
      </div>
    </div>
  );
}

export function ManageItems({ categoryId }: { categoryId: string }) {
  const s = useStore();
  const cat = s.library?.categories.find((c) => c.id === categoryId);
  const items = useMemo(() => itemsFor(categoryId, true), [s.library, s.prefs]);
  const hidden = new Set(state.prefs.hiddenItems);
  return (
    <div class="screen manage">
      <header class="topbar">
        <button data-nav class="btn ghost" onClick={() => pop()} aria-label="Back">←</button>
        <h1>{cat?.name || 'Category'}</h1>
      </header>
      <p class="muted small pad">{items.length - items.filter((i) => hidden.has(i.id)).length} of {items.length} visible.</p>
      <div class="manage-list" data-nav-group="manage-items">
        <VirtualList
          items={items}
          rowRem={4}
          getKey={(c) => c.id}
          render={(it, i) => (
            <ManageRow
              name={it.name}
              hidden={hidden.has(it.id)}
              index={i}
              total={items.length}
              onToggle={() => toggleHiddenItem(it.id)}
              onMove={(d) => moveItem(categoryId, it.id, d)}
            />
          )}
        />
      </div>
    </div>
  );
}
