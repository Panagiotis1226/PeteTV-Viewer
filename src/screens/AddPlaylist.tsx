import { useState } from 'preact/hooks';
import { toast } from '../components/Toast';
import { fetchText } from '../platform';
import { XtreamClient } from '../providers/xtream';
import { pop, resetTo } from '../router';
import { addPlaylist, refreshLibrary, state } from '../store';
import type { PlaylistSource } from '../types';
import { normalizeServer, uid } from '../util';
import { CUSTOM, presetFor, UA_PRESETS } from '../useragents';

type Tab = 'xtream' | 'm3u' | 'file';

/** Shared by the form and the phone-setup flow. Validates and saves a playlist. */
export async function savePlaylistFromInput(input: {
  id?: string; type: Tab; name?: string; url?: string; text?: string;
  server?: string; username?: string; password?: string; userAgent?: string;
}): Promise<void> {
  const id = input.id || uid();
  const ua = input.userAgent?.trim() || undefined;
  let src: PlaylistSource;
  if (input.type === 'xtream') {
    if (!input.server || !input.username || !input.password) throw new Error('Server, username and password are required');
    src = {
      id, type: 'xtream', name: input.name?.trim() || 'My IPTV',
      server: normalizeServer(input.server), username: input.username.trim(), password: input.password.trim(), userAgent: ua, createdAt: Date.now(),
    };
    await new XtreamClient(src, fetchText).login();
  } else if (input.type === 'm3u') {
    const url = (input.url || '').trim();
    if (!/^https?:\/\//i.test(url)) throw new Error('Enter a valid http(s) playlist URL');
    // An M3U link from an Xtream panel can be upgraded to the faster Xtream API.
    const m = /^(https?:\/\/[^/]+)\/get\.php\?(.*)$/i.exec(url);
    const q = m ? new URLSearchParams(m[2]) : null;
    if (m && q?.get('username') && q.get('password')) {
      src = {
        id, type: 'xtream', name: input.name?.trim() || 'My IPTV', server: m[1],
        username: q.get('username')!, password: q.get('password')!, userAgent: ua, createdAt: Date.now(),
      };
      try {
        await new XtreamClient(src, fetchText).login();
      } catch {
        src = { id, type: 'm3u', name: src.name, url, userAgent: ua, createdAt: Date.now() };
      }
    } else {
      src = { id, type: 'm3u', name: input.name?.trim() || 'My Playlist', url, userAgent: ua, createdAt: Date.now() };
    }
  } else {
    if (!input.text || !/#EXTINF/i.test(input.text)) throw new Error('That file does not look like an M3U playlist');
    src = { id, type: 'm3u', name: input.name?.trim() || 'Uploaded playlist', text: input.text, userAgent: ua, createdAt: Date.now() };
  }
  await addPlaylist(src);
  // addPlaylist() only loads the library when it isn't cached; force a reload after an edit.
  if (input.id) await refreshLibrary();
}

export function AddPlaylist({ editId }: { editId?: string }) {
  const existing = editId ? state.playlists.find((p) => p.id === editId) : undefined;
  const [tab, setTab] = useState<Tab>(existing ? (existing.type === 'xtream' ? 'xtream' : existing.url ? 'm3u' : 'file') : 'xtream');
  const [f, setF] = useState({
    name: existing?.name || '',
    server: existing?.server || '',
    username: existing?.username || '',
    password: existing?.password || '',
    url: existing?.url || '',
    userAgent: existing?.userAgent || '',
    text: existing?.text || '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [uaChoice, setUaChoice] = useState(() => presetFor(existing?.userAgent));
  const bind = (k: keyof typeof f) => ({
    value: f[k],
    onInput: (e: Event) => setF({ ...f, [k]: (e.currentTarget as HTMLInputElement).value }),
  });

  const submit = async (e?: Event) => {
    e?.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await savePlaylistFromInput({ id: editId, type: tab, ...f });
      toast('Playlist added');
      resetTo({ name: 'home' });
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (e: Event) => {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    setFileName(file.name);
    setF({ ...f, text: await file.text(), name: f.name || file.name.replace(/\.m3u8?$/i, '') });
  };

  return (
    <div class="screen form-screen">
      <header class="topbar">
        <button data-nav class="btn ghost" onClick={() => pop()} aria-label="Back">←</button>
        <h1>{existing ? 'Edit playlist' : 'Add playlist'}</h1>
      </header>
      <form class="form" onSubmit={submit}>
        <div class="seg">
          <button type="button" data-nav data-nav-default class={'pill' + (tab === 'xtream' ? ' active' : '')} onClick={() => setTab('xtream')}>Xtream Codes</button>
          <button type="button" data-nav class={'pill' + (tab === 'm3u' ? ' active' : '')} onClick={() => setTab('m3u')}>M3U URL</button>
          <button type="button" data-nav class={'pill' + (tab === 'file' ? ' active' : '')} onClick={() => setTab('file')}>M3U File</button>
        </div>
        <label>Name<input data-nav {...bind('name')} placeholder="e.g. Home IPTV" /></label>
        {tab === 'xtream' && (
          <>
            <label>Server URL<input data-nav {...bind('server')} placeholder="http://provider.com:8080" inputMode="url" autoCapitalize="off" autoCorrect="off" spellcheck={false} /></label>
            <label>Username<input data-nav {...bind('username')} autoCapitalize="off" autoCorrect="off" spellcheck={false} /></label>
            <label>Password<input data-nav {...bind('password')} type="password" /></label>
          </>
        )}
        {tab === 'm3u' && (
          <label>Playlist URL<input data-nav {...bind('url')} placeholder="http://provider.com/get.php?username=…&type=m3u_plus" inputMode="url" autoCapitalize="off" autoCorrect="off" spellcheck={false} /></label>
        )}
        {tab === 'file' && (
          <label class="file">
            {fileName ? `Selected: ${fileName}` : 'Choose an .m3u / .m3u8 file'}
            <input data-nav type="file" accept=".m3u,.m3u8,audio/x-mpegurl,application/x-mpegurl,text/plain" onChange={onFile} />
          </label>
        )}
        <label>
          Player User-Agent — if channels won't load, pick the app that works for you
          <select
            data-nav
            value={uaChoice}
            onChange={(e) => {
              const v = (e.currentTarget as HTMLSelectElement).value;
              setUaChoice(v);
              if (v !== CUSTOM) setF({ ...f, userAgent: v });
            }}
          >
            {UA_PRESETS.map((p) => <option key={p.label} value={p.value}>{p.label}</option>)}
            <option value={CUSTOM}>Custom…</option>
          </select>
        </label>
        {uaChoice === CUSTOM && (
          <label>Custom User-Agent<input data-nav {...bind('userAgent')} placeholder="e.g. MyPlayer/1.0" autoCapitalize="off" autoCorrect="off" spellcheck={false} /></label>
        )}
        {err && <div class="banner error">{err}</div>}
        <div class="row gap">
          <button data-nav class="btn primary lg" type="submit" disabled={busy}>{busy ? 'Connecting…' : existing ? 'Save' : 'Add playlist'}</button>
          <button data-nav class="btn lg" type="button" onClick={() => pop()}>Cancel</button>
        </div>
        <p class="muted small">Your login is stored only on this device and sent only to your provider.</p>
      </form>
    </div>
  );
}
