# PeteTV — plan & design notes

## Goals (from the brief)
1. Import M3U playlists and log in with Xtream Codes. ✅
2. Run on Android TV and Fire TV, with a realistic path to iOS. ✅ (iOS: see below)
3. Easy to run, light enough for cheap TV sticks. ✅
4. Optional web version on a self-hosted server. ✅
5. Hide and reorder channels and categories. ✅
6. Live TV, Movies and Series sections. ✅
7. IBO-style UX without MAC-address activation; free and open source. ✅ (phone setup via LAN + PIN)

## Technology decision
| Option | Android TV/Fire TV | Web | iOS | Weight on a Fire Stick | Verdict |
|---|---|---|---|---|---|
| Kotlin native | ✅ best | ❌ separate app | ❌ | lightest | 3 codebases |
| Flutter | ✅ | ⚠️ heavy CanvasKit web | ✅ | medium; D-pad focus needs work | ok, web weak |
| React Native (tvOS fork) | ✅ | ⚠️ react-native-web | ✅ + tvOS | medium/heavy | complex builds |
| **Web UI + Capacitor + native player** | ✅ | ✅ same code | ✅ | light UI, native decode | **chosen** |

Video playback is the only thing that really needs native code on TV hardware, so it is native (Media3/ExoPlayer) while the UI is shared.

## Components
- `src/parsers/m3u.ts` — streaming-style line parser (100k entries < 1 s), classifies live/movie/series, groups `S01E02` episodes.
- `src/providers/xtream.ts` — Xtream `player_api.php` client (categories, streams, VOD info, series info, short EPG).
- `src/store.ts` — playlists, cached libraries and per-playlist prefs in IndexedDB; derived, user-ordered views.
- `src/nav/spatial.ts` — geometric D-pad navigation with focus groups/memory and modal scopes.
- `src/components/VirtualList.tsx` — fixed-size virtual list/grid so 50k+ items render ~15 rows.
- `src/player/` — native player bridge or the web player (hls.js / mpegts.js loaded on demand).
- `server/index.js` — zero-dependency Node server: static files + `/api/proxy` (CORS, mixed content, User-Agent, HLS URI rewriting, Range, SSRF guard, optional Basic auth).
- `android/` — Capacitor project + `PeteTVPlugin` (play, download, setup server), `PlayerActivity` (ExoPlayer, zapping, auto-reconnect), `SetupServer` (LAN page + PIN).
- `tools/mock-iptv/` — fake provider with ffmpeg-generated streams used by tests.

## Privacy & security
- Credentials are stored only on the device (TV app) or in the browser (web). The web server is a stateless relay.
- The proxy blocks private/loopback targets by default (checked at connect time to defeat DNS rebinding) and supports a password and a host allow-list.
- The phone-setup server only runs while its screen is open, only on the LAN, and needs the PIN shown on the TV.

## Testing done
- Unit: M3U parsing/classification, Xtream client against the mock provider, ordering helpers, proxy (SSRF, CORS, HLS rewrite, Range, auth).
- E2E (Playwright + Chrome): Xtream login, D-pad navigation, live playback via HLS and zapping, EPG panel, hide/reorder persistence, movies with resume + continue watching, series seasons/episodes, M3U URL + file upload, search, favorites, bad-login error.
- Android: APK build, signature and manifest (Leanback launcher, banner) verified; phone-setup server + page tested on a JVM. **Not yet verified on a physical Fire TV / Android TV device** — no emulator was available in the build environment.

## Roadmap
1. Field-test on Fire TV Stick (Lite / 4K / 4K Max) and a Google TV device; tune focus and buffering.
2. Full XMLTV EPG grid (`url-tvg` / Xtream `xmltv.php`), catch-up/timeshift.
3. Parental PIN for hidden categories; multi-audio/subtitle selection in the web player.
4. iOS: `npx cap add ios`, implement `PeteTVPlugin` in Swift (AVPlayerViewController, URLSession download). Note: AVPlayer doesn't play raw MPEG-TS, so request HLS (`.m3u8`) for live on iOS.
5. tvOS: native SwiftUI shell reusing the provider logic (WKWebView isn't available on tvOS).
