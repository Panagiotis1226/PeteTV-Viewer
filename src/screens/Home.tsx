import { useEffect, useState } from 'preact/hooks';
import { Logo } from '../components/Logo';
import { toast } from '../components/Toast';
import { isNative } from '../platform';
import { push } from '../router';
import { activePlaylist, countsFor, getItem, refreshLibrary, state, useStore } from '../store';
import { playHistory } from './common';

function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(t);
  }, []);
  return <span class="clock">{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>;
}

export function Welcome() {
  return (
    <div class="screen welcome">
      <div class="brand big">Pete<span>TV</span></div>
      <p class="muted">Free &amp; open-source IPTV player. Add your playlist to get started — nothing is sent anywhere except your provider.</p>
      <div class="row gap">
        <button data-nav data-nav-default class="btn primary lg" onClick={() => push({ name: 'addPlaylist' })}>+ Add playlist</button>
        {isNative && <button data-nav class="btn lg" onClick={() => push({ name: 'phoneSetup' })}>📱 Set up from phone</button>}
      </div>
    </div>
  );
}

export function Home() {
  const s = useStore();
  const pl = activePlaylist();
  if (!pl) return <Welcome />;
  const lib = s.library;
  const acc = lib?.account;
  const tiles = [
    { kind: 'live' as const, label: 'Live TV', icon: '📺', cls: 't-live' },
    { kind: 'movie' as const, label: 'Movies', icon: '🎬', cls: 't-movie' },
    { kind: 'series' as const, label: 'Series', icon: '🎞️', cls: 't-series' },
  ];
  const recent = s.prefs.history.filter((h) => h.kind !== 'live' && h.position && h.duration && h.position < h.duration * 0.95).slice(0, 12);

  const reload = () => refreshLibrary().then(() => toast('Playlist updated')).catch((e) => toast(e.message));

  return (
    <div class="screen home">
      <header class="topbar">
        <div class="brand">Pete<span>TV</span></div>
        <div class="grow" />
        <button data-nav class="pill" onClick={() => push({ name: 'settings' })} title="Switch playlist">
          {pl.name}{state.playlists.length > 1 ? ' ▾' : ''}
        </button>
        {acc?.expires ? <span class="muted small">Expires {new Date(acc.expires).toLocaleDateString()}</span> : null}
        <Clock />
      </header>

      {s.loading && <div class="banner">{s.loading}</div>}
      {s.error && !s.loading && (
        <div class="banner error">
          {s.error} <button data-nav class="btn sm" onClick={reload}>Retry</button>
        </div>
      )}

      <div class="tiles">
        {tiles.map((t, i) => (
          <button
            key={t.kind}
            data-nav
            data-nav-default={i === 0 ? '' : undefined}
            class={'tile ' + t.cls}
            disabled={!lib}
            onClick={() => push({ name: 'section', kind: t.kind })}
          >
            <span class="tile-icon">{t.icon}</span>
            <span class="tile-label">{t.label}</span>
            <span class="tile-count">{lib ? countsFor(t.kind).toLocaleString() : '…'}</span>
          </button>
        ))}
      </div>

      <div class="actions">
        <button data-nav class="btn" onClick={() => push({ name: 'manage', kind: 'live' })}>☰ Hide &amp; reorder</button>
        <button data-nav class="btn" onClick={reload} disabled={!!s.loading}>⟳ Reload playlist</button>
        <button data-nav class="btn" onClick={() => push({ name: 'addPlaylist' })}>+ Add playlist</button>
        <button data-nav class="btn" onClick={() => push({ name: 'settings' })}>⚙ Settings</button>
      </div>

      {recent.length > 0 && (
        <section class="continue">
          <h2>Continue watching</h2>
          <div class="hscroll" data-nav-group="continue">
            {recent.map((h) => {
              const series = h.seriesId ? getItem(h.seriesId) : undefined;
              return (
                <button key={h.id} data-nav class="cw-card" onClick={() => playHistory(h)}>
                  <Logo src={h.logo || series?.logo} name={series?.name || h.name} class="cw-img" />
                  <div class="cw-title">{series ? series.name : h.name}</div>
                  {series && <div class="cw-sub">{h.name}</div>}
                  <div class="progress"><div style={{ width: `${Math.min(100, ((h.position || 0) / (h.duration || 1)) * 100)}%` }} /></div>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
