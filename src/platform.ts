import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { PlayRequest, PlayResult } from './types';

export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform(); // 'android' | 'ios' | 'web'

export const DEFAULT_UA = 'VLC/3.0.21 LibVLC/3.0.21';

interface PeteTVPlugin {
  play(req: PlayRequest): Promise<PlayResult>;
  download(opts: { url: string; userAgent?: string }): Promise<{ path: string }>;
  startSetupServer(opts: { pin: string; userAgents: { label: string; value: string }[] }): Promise<{ url: string; ip: string; port: number }>;
  stopSetupServer(): Promise<void>;
  addListener(event: 'setupData', cb: (d: { data: string }) => void): Promise<PluginListenerHandle>;
}

export const Native = registerPlugin<PeteTVPlugin>('PeteTV');

/** True when served by our own Node server (it exposes /api/health). */
let serverMode: boolean | null = null;
export async function detectServer(): Promise<boolean> {
  if (isNative) return (serverMode = false);
  if (serverMode !== null) return serverMode;
  try {
    const r = await fetch('api/health', { cache: 'no-store' });
    serverMode = r.ok && (await r.json()).app === 'petetv';
  } catch {
    serverMode = false;
  }
  return serverMode;
}
export const hasServer = () => serverMode === true;

export function proxyUrl(url: string, userAgent?: string): string {
  let u = `api/proxy?url=${encodeURIComponent(url)}`;
  if (userAgent) u += `&ua=${encodeURIComponent(userAgent)}`;
  return u;
}

/** Fetch text from an IPTV provider, bypassing CORS where we can. */
export async function fetchText(url: string, userAgent?: string): Promise<string> {
  const ua = userAgent || DEFAULT_UA;
  if (isNative) {
    // Native download to a cache file, then read it via the WebView's local server.
    const { path } = await Native.download({ url, userAgent: ua });
    const r = await fetch(Capacitor.convertFileSrc('file://' + path));
    return r.text();
  }
  const target = hasServer() ? proxyUrl(url, ua) : url;
  let r: Response;
  try {
    r = await fetch(target);
  } catch (e) {
    throw new Error(
      hasServer()
        ? 'Network error reaching the PeteTV server'
        : 'Could not reach the provider (browser blocked the request). Run the PeteTV web server to enable the proxy.',
    );
  }
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try {
      const j = await r.json();
      if (j && j.error) msg = j.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  return r.text();
}
