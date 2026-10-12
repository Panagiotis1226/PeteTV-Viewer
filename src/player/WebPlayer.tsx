import { useEffect, useRef, useState } from 'preact/hooks';
import { hasServer, proxyUrl } from '../platform';
import { pop } from '../router';
import { state } from '../store';
import type { PlayRequest } from '../types';
import { fmtTime } from '../util';
import { onPlaybackEnded } from './index';

type Engine = { destroy(): void };

function streamType(url: string): 'hls' | 'ts' | 'file' {
  const path = url.split('?')[0].toLowerCase();
  if (path.endsWith('.m3u8') || path.includes('.m3u8') || /[?&](type|output)=(m3u8|hls)/i.test(url)) return 'hls';
  if (path.endsWith('.ts') || !/\.[a-z0-9]{2,4}$/.test(path)) return 'ts';
  return 'file';
}

function shouldProxy(url: string): boolean {
  if (!hasServer()) return false;
  const mode = state.settings.webProxy;
  if (mode === 'always') return true;
  if (mode === 'never') return false;
  // auto: proxy unless the stream is https *and* a plain file the <video> tag can load directly
  return !(url.startsWith('https:') && streamType(url) === 'file');
}

async function attach(video: HTMLVideoElement, rawUrl: string, ua: string | undefined, live: boolean, onFatal: (msg: string) => void): Promise<Engine> {
  const type = streamType(rawUrl);
  // Absolute URL: mpegts.js fetches from a Web Worker where relative URLs fail.
  const url = shouldProxy(rawUrl) ? new URL(proxyUrl(rawUrl, ua), location.href).href : rawUrl;
  if (type === 'hls') {
    // Prefer hls.js wherever MSE exists (more robust than Chrome's new native HLS);
    // Safari / iOS fall through to the native player.
    const Hls = (await import('hls.js')).default;
    if (Hls.isSupported() && !/^((?!chrome|android).)*safari/i.test(navigator.userAgent)) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: false, backBufferLength: 30 });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
        else onFatal('Playback error: ' + data.details);
      });
      hls.loadSource(url);
      hls.attachMedia(video);
      return hls;
    }
  }
  if (type === 'ts') {
    const mpegts = (await import('mpegts.js')).default;
    if (mpegts.getFeatureList().mseLivePlayback) {
      const p = mpegts.createPlayer({ type: 'mpegts', isLive: live, url }, {
        enableWorker: true, lazyLoad: false, liveBufferLatencyChasing: false, autoCleanupSourceBuffer: true,
      });
      p.on(mpegts.Events.ERROR, (_t: string, detail: string) => onFatal('Stream error: ' + detail));
      p.attachMediaElement(video);
      p.load();
      return { destroy: () => { p.pause(); p.unload(); p.detachMediaElement(); p.destroy(); } };
    }
  }
  video.src = url;
  return { destroy: () => { video.removeAttribute('src'); video.load(); } };
}

export function WebPlayer({ req }: { req: PlayRequest }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [index, setIndex] = useState(req.index);
  const [controls, setControls] = useState(true);
  const [paused, setPaused] = useState(false);
  const [time, setTime] = useState({ cur: 0, dur: 0 });
  const [error, setError] = useState<string | null>(null);
  const [buffering, setBuffering] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const posRef = useRef({ cur: 0, dur: 0 });
  const live = req.kind === 'live';
  const item = req.items[index];

  const poke = () => {
    setControls(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControls(false), 3500);
  };

  // (Re)attach the stream whenever the channel changes.
  useEffect(() => {
    const video = videoRef.current!;
    let engine: Engine | null = null;
    let cancelled = false;
    setError(null);
    setBuffering(true);
    const start = index === req.index ? req.startPosition || 0 : 0;
    attach(video, item.url, req.userAgent, live, (m) => setError(m)).then((e) => {
      if (cancelled) return e.destroy();
      engine = e;
      if (start > 5) {
        const seek = () => { video.currentTime = start; video.removeEventListener('loadedmetadata', seek); };
        video.addEventListener('loadedmetadata', seek);
      }
      video.play().catch(() => setPaused(true));
    }).catch((e) => setError(String(e)));
    poke();
    return () => {
      cancelled = true;
      engine?.destroy();
    };
  }, [index, attempt]);

  const close = () => {
    // Read the element directly: a seek/resume may not have fired timeupdate yet.
    const v = videoRef.current;
    const position = v && v.currentTime > 0 ? v.currentTime : posRef.current.cur;
    const duration = v && isFinite(v.duration) && v.duration > 0 ? v.duration : posRef.current.dur;
    onPlaybackEnded({ ...req }, { index, position, duration });
    pop();
  };

  const zap = (d: number) => {
    if (req.items.length < 2) return;
    setIndex((i) => (i + d + req.items.length) % req.items.length);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const v = videoRef.current!;
      let handled = true;
      switch (e.key) {
        case 'Escape': case 'Backspace': case 'GoBack': case 'BrowserBack':
          close();
          break;
        case 'Enter': case ' ': case 'MediaPlayPause': case 'k':
          // Let a focused player button handle Enter itself.
          if (e.key === 'Enter' && (document.activeElement as HTMLElement | null)?.closest('.player button')) { poke(); return; }
          if (v.paused) v.play(); else v.pause();
          poke();
          break;
        case 'ArrowLeft': case 'MediaRewind':
          if (!live) v.currentTime = Math.max(0, v.currentTime - 10);
          poke();
          break;
        case 'ArrowRight': case 'MediaFastForward':
          if (!live) v.currentTime = Math.min(v.duration || Infinity, v.currentTime + 10);
          poke();
          break;
        case 'ArrowUp': case 'ChannelUp': case 'PageUp':
          if (live) zap(-1); else poke();
          break;
        case 'ArrowDown': case 'ChannelDown': case 'PageDown':
          if (live) zap(1); else poke();
          break;
        case 'MediaTrackNext': zap(1); break;
        case 'MediaTrackPrevious': zap(-1); break;
        case 'f':
          if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.();
          break;
        default:
          handled = false;
      }
      if (handled) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [controls, index, attempt]);

  useEffect(() => () => {
    clearTimeout(hideTimer.current);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }, []);

  const pct = time.dur > 0 && isFinite(time.dur) ? (time.cur / time.dur) * 100 : 0;
  return (
    <div class={'player' + (controls ? ' show-ui' : '')} data-nav-scope onMouseMove={poke} onClick={poke}>
      <video
        ref={videoRef}
        class="player-video"
        playsInline
        autoPlay
        onTimeUpdate={(e) => {
          const v = e.currentTarget as HTMLVideoElement;
          posRef.current = { cur: v.currentTime, dur: isFinite(v.duration) ? v.duration : 0 };
          setTime(posRef.current);
        }}
        onPlaying={() => { setBuffering(false); setPaused(false); setError(null); }}
        onWaiting={() => setBuffering(true)}
        onPause={() => setPaused(true)}
        onPlay={() => setPaused(false)}
        onEnded={() => { if (!live && index < req.items.length - 1) setIndex(index + 1); }}
        onError={(e) => {
          const err = (e.currentTarget as HTMLVideoElement).error;
          setError('This stream could not be played in the browser.' + (err?.message ? ` (${err.message})` : ''));
        }}
      />
      {buffering && !error && <div class="spinner" aria-label="Loading" />}
      {error && (
        <div class="player-error">
          <p>{error}</p>
          <button data-nav data-nav-default class="btn" onClick={() => { setError(null); setAttempt((a) => a + 1); }}>Retry</button>
          <button data-nav class="btn" onClick={close}>Back</button>
        </div>
      )}
      <div class="player-top">
        <button data-nav class="btn ghost" onClick={close} aria-label="Back">←</button>
        <div class="player-title">
          {live && <span class="ch-num">{index + 1}</span>}
          {item.title}
        </div>
      </div>
      <div class="player-bottom">
        {!live && (
          <div class="seek">
            <span>{fmtTime(time.cur)}</span>
            <input
              type="range" min={0} max={time.dur || 0} step={1} value={time.cur}
              onInput={(e) => { const v = videoRef.current!; v.currentTime = Number((e.currentTarget as HTMLInputElement).value); }}
              aria-label="Seek"
            />
            <span>{fmtTime(time.dur)}</span>
          </div>
        )}
        <div class="player-buttons">
          {req.items.length > 1 && <button data-nav class="btn" onClick={() => zap(-1)}>{live ? 'Ch −' : '⏮ Prev'}</button>}
          <button data-nav data-nav-default class="btn primary" onClick={() => { const v = videoRef.current!; if (v.paused) v.play(); else v.pause(); }}>
            {paused ? '▶ Play' : '❚❚ Pause'}
          </button>
          {req.items.length > 1 && <button data-nav class="btn" onClick={() => zap(1)}>{live ? 'Ch +' : 'Next ⏭'}</button>}
          <button data-nav class="btn" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.())}>⛶ Fullscreen</button>
        </div>
        <div class="hint">{live ? '↑/↓ change channel · Enter pause · Esc back' : '←/→ seek 10s · Enter pause · Esc back'}</div>
      </div>
    </div>
  );
}
