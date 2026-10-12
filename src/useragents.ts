/**
 * User-Agent presets. Some IPTV providers only serve streams to the players
 * they recognise, so picking the UA of the app that works for you often helps.
 * These are commonly used values; providers differ, so "Custom" stays available.
 */
export const UA_PRESETS: { label: string; value: string }[] = [
  { label: 'Default (VLC)', value: '' },
  { label: 'IPTV Smarters Player Lite', value: 'iptv_smarters_player_lite' },
  { label: 'IPTV Smarters Pro', value: 'IPTVSmartersPlayer' },
  { label: 'TiviMate', value: 'TiviMate/5.1.6 (Android 12)' },
  { label: 'Kodi', value: 'Kodi/21.2 (Linux; Android 12) Android/12 Sys_CPU/aarch64 App_Bitness/64 Version/21.2' },
  { label: 'VLC (explicit)', value: 'VLC/3.0.21 LibVLC/3.0.21' },
  { label: 'ExoPlayer / Android', value: 'ExoPlayerLib/2.19.1' },
  { label: 'okhttp (Android apps)', value: 'okhttp/4.12.0' },
  { label: 'FFmpeg (Lavf)', value: 'Lavf/60.16.100' },
  { label: 'Chrome (desktop browser)', value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36' },
];

export const CUSTOM = '__custom';

/** Which <select> option represents this stored UA value. */
export function presetFor(ua: string | undefined): string {
  const v = ua || '';
  return UA_PRESETS.some((p) => p.value === v) ? v : CUSTOM;
}
