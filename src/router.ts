import { useEffect, useState } from 'preact/hooks';
import type { Kind, PlayRequest } from './types';
import { focusDefault, focusEl } from './nav/spatial';

export type Route =
  | { name: 'home' }
  | { name: 'section'; kind: Kind }
  | { name: 'movie'; id: string }
  | { name: 'series'; id: string }
  | { name: 'settings' }
  | { name: 'addPlaylist'; editId?: string }
  | { name: 'manage'; kind: Kind }
  | { name: 'manageItems'; categoryId: string }
  | { name: 'phoneSetup' }
  | { name: 'guide' }
  | { name: 'player'; req: PlayRequest };

interface Entry {
  key: number;
  route: Route;
  /** element that had focus when we navigated away */
  focus?: HTMLElement | null;
}

let seq = 0;
export const stack: Entry[] = [{ key: seq++, route: { name: 'home' } }];
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());

function afterRender(fn: () => void) {
  requestAnimationFrame(() => requestAnimationFrame(fn));
}

export function push(route: Route) {
  stack[stack.length - 1].focus = document.activeElement as HTMLElement | null;
  stack.push({ key: seq++, route });
  notify();
  afterRender(focusDefault);
}

export function replace(route: Route) {
  stack[stack.length - 1] = { key: seq++, route };
  notify();
  afterRender(focusDefault);
}

/** Returns false when already at the root. */
export function pop(): boolean {
  if (stack.length <= 1) return false;
  stack.pop();
  notify();
  const prev = stack[stack.length - 1].focus;
  afterRender(() => {
    if (!(prev && prev.isConnected && focusEl(prev))) focusDefault();
  });
  return true;
}

export function resetTo(route: Route) {
  stack.splice(0, stack.length, { key: seq++, route });
  notify();
  afterRender(focusDefault);
}

export function useRouter() {
  const [, setN] = useState(0);
  const force = () => setN((n) => n + 1);
  useEffect(() => {
    subs.add(force);
    return () => void subs.delete(force);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return stack;
}

export const current = () => stack[stack.length - 1].route;
