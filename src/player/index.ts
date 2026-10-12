import { isNative, Native } from '../platform';
import { push } from '../router';
import { recordHistory, getItem } from '../store';
import type { PlayRequest, PlayResult } from '../types';

/** Called by both the native and the web player when playback ends. */
export function onPlaybackEnded(req: PlayRequest, res: PlayResult) {
  const it = req.items[res.index];
  if (!it) return;
  const series = req.seriesId ? getItem(req.seriesId) : undefined;
  recordHistory({
    id: it.id,
    kind: req.kind,
    name: it.title,
    logo: it.logo || series?.logo,
    seriesId: req.seriesId,
    url: it.url,
    position: req.kind === 'live' ? undefined : Math.floor(res.position),
    duration: req.kind === 'live' ? undefined : Math.floor(res.duration),
    at: Date.now(),
  });
}

export async function play(req: PlayRequest) {
  if (isNative) {
    // Keep the bridge payload small: only send a window of channels around the selection.
    const W = 300;
    const from = Math.max(0, req.index - W);
    const sent: PlayRequest = { ...req, items: req.items.slice(from, req.index + W + 1), index: req.index - from };
    try {
      const res = await Native.play(sent);
      onPlaybackEnded(sent, res);
    } catch (e) {
      console.error('native play failed', e);
    }
    return;
  }
  push({ name: 'player', req });
}
