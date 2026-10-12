import { toast } from '../components/Toast';
import { hasServer, isNative } from '../platform';
import { push, pop } from '../router';
import { activePlaylist, refreshLibrary, removePlaylist, saveSettings, switchPlaylist, useStore } from '../store';
import { epgSourceUrl, ensureEpg, refreshEpg } from '../epg';
import { useEffect } from 'preact/hooks';
import type { Settings as S } from '../types';

function Choice<K extends keyof S>({ label, k, options, help }: { label: string; k: K; options: [S[K], string][]; help?: string }) {
  const s = useStore();
  return (
    <div class="setting">
      <div>
        <div>{label}</div>
        {help && <div class="muted small">{help}</div>}
      </div>
      <div class="seg">
        {options.map(([v, l]) => (
          <button key={String(v)} data-nav class={'pill' + (s.settings[k] === v ? ' active' : '')} onClick={() => saveSettings({ [k]: v } as Partial<S>)}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

function TvGuideSettings() {
  const s = useStore();
  useEffect(() => { ensureEpg({ network: false }); }, []);
  const src = epgSourceUrl(activePlaylist(), s.library);
  const masked = src?.replace(/(username|password)=[^&]+/g, '$1=•••');
  return (
    <>
      <h2>TV Guide</h2>
      <div class="setting">
        <div>
          <div>Guide source</div>
          <div class="muted small">{masked || 'None — add a guide (XMLTV) URL with Edit on the playlist above'}</div>
          <div class="muted small">
            {s.epgStatus || (s.epg
              ? `Updated ${new Date(s.epg.loadedAt).toLocaleString()} · ${s.epg.count.toLocaleString()} programmes for ${Object.keys(s.epg.progs).length.toLocaleString()} channels`
              : s.epgError || 'Not downloaded yet — it downloads when you open the TV Guide')}
          </div>
        </div>
        <button data-nav class="btn" disabled={!src || !!s.epgStatus} onClick={() => refreshEpg()}>⟳ Update guide now</button>
      </div>
    </>
  );
}

export function Settings() {
  const s = useStore();
  const active = s.settings.activePlaylistId || s.playlists[0]?.id;
  return (
    <div class="screen settings">
      <header class="topbar">
        <button data-nav class="btn ghost" onClick={() => pop()} aria-label="Back">←</button>
        <h1>Settings</h1>
      </header>
      <div class="settings-body">
        <h2>Playlists</h2>
        {s.playlists.map((p) => (
          <div key={p.id} class={'playlist' + (p.id === active ? ' active' : '')}>
            <div class="grow">
              <div>{p.name} {p.id === active && <span class="badge">Active</span>}</div>
              <div class="muted small">{p.type === 'xtream' ? `Xtream · ${p.server}` : p.url ? `M3U · ${p.url.replace(/(username|password)=[^&]+/g, '$1=•••')}` : 'M3U · uploaded file'}</div>
            </div>
            {p.id !== active && <button data-nav class="btn sm" onClick={() => switchPlaylist(p.id).catch((e) => toast(e.message))}>Use</button>}
            {p.id === active && <button data-nav class="btn sm" onClick={() => refreshLibrary().then(() => toast('Updated')).catch((e) => toast(e.message))}>⟳ Reload</button>}
            <button data-nav class="btn sm" onClick={() => push({ name: 'addPlaylist', editId: p.id })}>Edit</button>
            <button data-nav class="btn sm danger" onClick={() => { if (confirm(`Remove "${p.name}"?`)) removePlaylist(p.id); }}>Remove</button>
          </div>
        ))}
        <div class="row gap">
          <button data-nav data-nav-default class="btn primary" onClick={() => push({ name: 'addPlaylist' })}>+ Add playlist</button>
          {isNative && <button data-nav class="btn" onClick={() => push({ name: 'phoneSetup' })}>📱 Set up from phone</button>}
        </div>

        <TvGuideSettings />

        <h2>Playback</h2>
        <Choice label="Live stream format (Xtream)" k="liveFormat" options={[['auto', 'Auto'], ['ts', 'MPEG-TS'], ['m3u8', 'HLS']]}
          help="Auto uses MPEG-TS on TV apps and HLS in browsers. Switch if channels fail to start." />
        <Choice label="Buffer size" k="buffer" options={[['small', 'Fast zapping'], ['normal', 'Normal'], ['large', 'Large'], ['xlarge', 'Very large']]}
          help="Smaller starts channels faster; larger rides out weak Wi-Fi and busy providers (more memory, slower start)." />
        {!isNative && (
          <Choice label="Stream through server proxy" k="webProxy" options={[['auto', 'Auto'], ['always', 'Always'], ['never', 'Never']]}
            help={hasServer() ? 'Needed for most IPTV providers in a browser (CORS / http streams).' : 'No PeteTV server detected — streams play directly.'} />
        )}

        <h2>About</h2>
        <p class="muted small">
          PeteTV is free, open-source software (MIT). It does not provide any content — you need your own playlist from a provider.
          Your playlists and credentials are stored only on this device{!isNative && hasServer() ? ' (the server only relays requests)' : ''}.
        </p>
        <p class="muted small">Version {__APP_VERSION__}</p>
      </div>
    </div>
  );
}
