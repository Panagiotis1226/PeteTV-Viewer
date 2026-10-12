import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

function remPx(): number {
  return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}

interface ListProps<T> {
  items: T[];
  /** row height in rem */
  rowRem: number;
  render: (item: T, index: number) => ComponentChildren;
  getKey: (item: T) => string;
  class?: string;
  overscan?: number;
  /** reset scroll when this changes */
  resetKey?: unknown;
}

/** Vertical virtualized list with fixed row height. */
export function VirtualList<T>({ items, rowRem, render, getKey, class: cls, overscan = 4, resetKey }: ListProps<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState(0);
  const [height, setHeight] = useState(800);
  const rowPx = rowRem * remPx();

  useLayoutEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    setHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = 0;
    setScroll(0);
  }, [resetKey]);

  const start = Math.max(0, Math.floor(scroll / rowPx) - overscan);
  const end = Math.min(items.length, Math.ceil((scroll + height) / rowPx) + overscan);
  const rows = [];
  for (let i = start; i < end; i++) {
    const it = items[i];
    rows.push(
      <div key={getKey(it)} class="vrow" style={{ top: `${i * rowRem}rem`, height: `${rowRem}rem` }}>
        {render(it, i)}
      </div>,
    );
  }
  return (
    <div ref={ref} class={'vlist ' + (cls || '')} onScroll={(e) => setScroll((e.currentTarget as HTMLDivElement).scrollTop)}>
      <div style={{ height: `${items.length * rowRem}rem`, position: 'relative' }}>{rows}</div>
    </div>
  );
}

interface GridProps<T> {
  items: T[];
  /** minimum cell width / fixed cell height in rem */
  cellRem: number;
  cellHeightRem: number;
  gapRem?: number;
  render: (item: T, index: number) => ComponentChildren;
  getKey: (item: T) => string;
  class?: string;
  resetKey?: unknown;
}

/** Virtualized grid with fixed cell size; column count adapts to width. */
export function VirtualGrid<T>({ items, cellRem, cellHeightRem, gapRem = 1, render, getKey, class: cls, resetKey }: GridProps<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState(0);
  const [size, setSize] = useState({ w: 1000, h: 800 });

  useLayoutEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = 0;
    setScroll(0);
  }, [resetKey]);

  const rem = remPx();
  const gap = gapRem * rem;
  const cols = Math.max(1, Math.floor((size.w - gap) / (cellRem * rem + gap)));
  const cellW = (size.w - gap * (cols + 1)) / cols;
  const rowPx = cellHeightRem * rem + gap;
  const rowsTotal = Math.ceil(items.length / cols);
  const startRow = Math.max(0, Math.floor(scroll / rowPx) - 2);
  const endRow = Math.min(rowsTotal, Math.ceil((scroll + size.h) / rowPx) + 2);
  const cells = [];
  for (let r = startRow; r < endRow; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (i >= items.length) break;
      const it = items[i];
      cells.push(
        <div
          key={getKey(it)}
          class="vcell"
          style={{ top: `${gap + r * rowPx}px`, left: `${gap + c * (cellW + gap)}px`, width: `${cellW}px`, height: `${cellHeightRem}rem` }}
        >
          {render(it, i)}
        </div>,
      );
    }
  }
  return (
    <div ref={ref} class={'vlist ' + (cls || '')} onScroll={(e) => setScroll((e.currentTarget as HTMLDivElement).scrollTop)}>
      <div style={{ height: `${rowsTotal * rowPx + gap}px`, position: 'relative' }}>{cells}</div>
    </div>
  );
}
