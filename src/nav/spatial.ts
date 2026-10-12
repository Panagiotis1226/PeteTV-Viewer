/**
 * Lightweight spatial (D-pad) navigation for TV remotes, also used for
 * keyboard navigation on the web.
 *
 * - Focusable elements: anything with [data-nav] (buttons, inputs, tiles).
 * - Scopes: the last element with [data-nav-scope] in the DOM (modals/overlays)
 *   traps focus; otherwise the whole document.
 * - Groups: [data-nav-group="name"] remembers its last focused child, so moving
 *   back into a list returns to where you were.
 * - [data-nav-enter="first"] on a group: entering it without a remembered
 *   element focuses its first item instead of the geometrically nearest.
 * - [data-nav-default] marks the element that gets focus when a screen opens.
 */

type Dir = 'up' | 'down' | 'left' | 'right';

const KEY_DIR: Record<string, Dir> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
};

const lastInGroup = new WeakMap<Element, HTMLElement>();

function scopeRoot(): ParentNode {
  const scopes = document.querySelectorAll('[data-nav-scope]');
  return scopes.length ? scopes[scopes.length - 1] : document;
}

function visible(el: HTMLElement): boolean {
  if (el.hasAttribute('disabled')) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function candidates(): HTMLElement[] {
  return Array.from(scopeRoot().querySelectorAll<HTMLElement>('[data-nav]')).filter(visible);
}

function groupOf(el: Element | null): Element | null {
  return el ? el.closest('[data-nav-group]') : null;
}

export function focusEl(el: HTMLElement | null | undefined) {
  if (!el) return false;
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  return true;
}

/** Focus the default element of the current scope (or the first focusable). */
export function focusDefault(): boolean {
  const root = scopeRoot();
  const def = root.querySelector<HTMLElement>('[data-nav-default]');
  if (def && visible(def)) return focusEl(def);
  const first = candidates()[0];
  return focusEl(first);
}

function inScope(el: Element | null): boolean {
  if (!el || el === document.body) return false;
  const root = scopeRoot();
  return root === document ? document.body.contains(el) : (root as Element).contains(el);
}

export function move(dir: Dir): boolean {
  const cur = document.activeElement as HTMLElement | null;
  if (!cur || !inScope(cur) || !cur.hasAttribute('data-nav')) return focusDefault();
  const r = cur.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of candidates()) {
    if (el === cur) continue;
    const c = el.getBoundingClientRect();
    let primary: number;
    let ortho: number;
    switch (dir) {
      case 'up':
        if (c.bottom > r.top + 1) continue;
        primary = r.top - c.bottom;
        ortho = Math.max(0, Math.max(c.left - r.right, r.left - c.right));
        break;
      case 'down':
        if (c.top < r.bottom - 1) continue;
        primary = c.top - r.bottom;
        ortho = Math.max(0, Math.max(c.left - r.right, r.left - c.right));
        break;
      case 'left':
        if (c.right > r.left + 1) continue;
        primary = r.left - c.right;
        ortho = Math.max(0, Math.max(c.top - r.bottom, r.top - c.bottom));
        break;
      default:
        if (c.left < r.right - 1) continue;
        primary = c.left - r.right;
        ortho = Math.max(0, Math.max(c.top - r.bottom, r.top - c.bottom));
    }
    // Prefer aligned elements strongly, then nearest; tie-break by centre distance.
    const ex = c.left + c.width / 2 - cx;
    const ey = c.top + c.height / 2 - cy;
    const score = primary + ortho * 4 + Math.sqrt(ex * ex + ey * ey) * 0.05;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  if (!best) return false;
  // Entering a different group: restore the remembered element if possible.
  const g = groupOf(best);
  if (g && g !== groupOf(cur)) {
    const remembered = lastInGroup.get(g);
    if (remembered && remembered.isConnected && visible(remembered) && g.contains(remembered)) best = remembered;
    else {
      const active = g.querySelector<HTMLElement>('[data-nav-active]');
      if (active && visible(active)) best = active;
      else if (g.getAttribute('data-nav-enter') === 'first') {
        const first = Array.from(g.querySelectorAll<HTMLElement>('[data-nav]')).find(visible);
        if (first) best = first;
      }
    }
  }
  return focusEl(best);
}

let backHandler: () => void = () => {};
export function setBackHandler(fn: () => void) {
  backHandler = fn;
}
export function goBack() {
  // An open popup (e.g. guide programme details) closes first; it listens for 'petetv-back'.
  if (document.querySelector('.modal')) {
    document.dispatchEvent(new Event('petetv-back'));
    return;
  }
  backHandler();
}

function isTextInput(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (!el) return false;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName !== 'INPUT') return false;
  const t = (el as HTMLInputElement).type;
  return !['checkbox', 'radio', 'button', 'submit', 'range'].includes(t);
}

export function installSpatialNav() {
  document.addEventListener('focusin', (e) => {
    const t = e.target as HTMLElement;
    const g = groupOf(t);
    if (g && t.hasAttribute('data-nav')) lastInGroup.set(g, t);
  });

  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;
    const active = document.activeElement;
    const dir = KEY_DIR[e.key];
    if (dir) {
      if (isTextInput(active)) {
        // Allow caret movement inside text fields; leave with up/down or at edges.
        const el = active as HTMLInputElement;
        const atStart = el.selectionStart === 0 && el.selectionEnd === 0;
        const atEnd = el.selectionStart === el.value.length;
        if ((dir === 'left' && !atStart) || (dir === 'right' && !atEnd)) return;
        if (el.tagName === 'TEXTAREA' && (dir === 'up' || dir === 'down')) return;
      }
      if (move(dir) || active?.hasAttribute('data-nav')) e.preventDefault();
      return;
    }
    if (e.key === 'Enter' && active && active.hasAttribute('data-nav') && !isTextInput(active)) {
      if (active.tagName === 'SELECT') {
        // Open the option list; if showPicker is unavailable, let the WebView handle Enter natively.
        const sel = active as HTMLSelectElement;
        if (typeof sel.showPicker === 'function') {
          try { sel.showPicker(); e.preventDefault(); } catch { /* fall back to native */ }
        }
        return;
      }
      if (active.tagName !== 'BUTTON' && active.tagName !== 'A') {
        e.preventDefault();
        (active as HTMLElement).click();
      }
      return;
    }
    if (e.key === 'Escape' || e.key === 'GoBack' || e.key === 'BrowserBack' ||
        (e.key === 'Backspace' && !isTextInput(active))) {
      e.preventDefault();
      goBack();
    }
  });
}
