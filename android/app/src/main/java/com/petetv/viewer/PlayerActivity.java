package com.petetv.viewer;

import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.TextView;
import androidx.annotation.NonNull;
import androidx.annotation.OptIn;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.datasource.HttpDataSource;
import androidx.media3.exoplayer.ExoPlaybackException;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.extractor.DefaultExtractorsFactory;
import androidx.media3.extractor.ts.DefaultTsPayloadReaderFactory;
import androidx.media3.ui.PlayerView;
import java.util.ArrayList;
import java.util.Locale;

/**
 * Full-screen native player (Media3 / ExoPlayer) — hardware decoding for
 * HLS, MPEG-TS, MP4 and MKV on low-powered TV sticks.
 *
 * Remote: OK = show controls · ↑/↓ or CH+/CH− = change channel (live) ·
 * ←/→ = seek 10s (movies/series) · Back = hide controls / exit.
 */
@OptIn(markerClass = UnstableApi.class)
public class PlayerActivity extends AppCompatActivity {

    static class Playlist {
        final ArrayList<String> ids = new ArrayList<>();
        final ArrayList<String> titles = new ArrayList<>();
        final ArrayList<String> urls = new ArrayList<>();
        int index;
        long startMs;
        String userAgent;
        boolean live;
        String buffer = "normal";
    }

    /** Handed over by {@link PeteTVPlugin#play}. */
    static Playlist pending;

    private Playlist pl;
    private ExoPlayer player;
    private PlayerView view;
    private TextView overlay;
    private TextView errorView;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private int retries;
    private boolean resultSet;
    private boolean audioDisabled;
    /** How long a stream may sit in "loading" before we treat it as stalled. */
    private static final long STALL_MS = 20000;

    private final Runnable hideOverlay = () -> overlay.setVisibility(View.GONE);
    private final Runnable hideError = () -> errorView.setVisibility(View.GONE);
    private final Runnable stallCheck = this::onStalled;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        pl = pending;
        pending = null;
        if (pl == null || pl.urls.isEmpty()) {
            finish();
            return;
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setContentView(R.layout.activity_player);
        WindowInsetsControllerCompat wic = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        wic.hide(WindowInsetsCompat.Type.systemBars());
        wic.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);

        view = findViewById(R.id.player_view);
        overlay = findViewById(R.id.channel_overlay);
        errorView = findViewById(R.id.error_text);

        DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
                .setUserAgent(pl.userAgent)
                .setAllowCrossProtocolRedirects(true)
                .setConnectTimeoutMs(15000)
                .setReadTimeoutMs(30000);
        DefaultExtractorsFactory extractors = new DefaultExtractorsFactory()
                .setTsExtractorFlags(DefaultTsPayloadReaderFactory.FLAG_ALLOW_NON_IDR_KEYFRAMES
                        | DefaultTsPayloadReaderFactory.FLAG_DETECT_ACCESS_UNITS);
        // EXTENSION_RENDERER_MODE_ON: hardware/platform decoders first, the bundled FFmpeg audio
        // decoder (AC-3, E-AC-3, DTS, TrueHD, …) when the device can't decode a track itself.
        DefaultRenderersFactory renderers = new DefaultRenderersFactory(this)
                .setEnableDecoderFallback(true)
                .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON);

        player = new ExoPlayer.Builder(this, renderers)
                .setLoadControl(loadControl(pl.buffer))
                .setMediaSourceFactory(new DefaultMediaSourceFactory(http, extractors))
                .build();
        player.addListener(new Player.Listener() {
            @Override
            public void onPlayerError(@NonNull PlaybackException error) {
                handleError(error);
            }

            @Override
            public void onPlaybackStateChanged(int state) {
                handler.removeCallbacks(stallCheck);
                if (state == Player.STATE_BUFFERING) {
                    handler.postDelayed(stallCheck, STALL_MS);
                } else if (state == Player.STATE_READY) {
                    retries = 0;
                    if (!audioDisabled) errorView.setVisibility(View.GONE);
                } else if (state == Player.STATE_ENDED) {
                    if (!pl.live && pl.index < pl.urls.size() - 1) {
                        load(pl.index + 1, 0);
                    } else if (!pl.live) {
                        finishWithResult();
                    }
                }
            }
        });
        view.setPlayer(player);
        view.setShowNextButton(pl.urls.size() > 1);
        view.setShowPreviousButton(pl.urls.size() > 1);
        if (pl.live) {
            view.setShowFastForwardButton(false);
            view.setShowRewindButton(false);
        }
        load(pl.index, pl.startMs);
    }

    /**
     * Settings → Buffer size. min/max = how much to keep buffered ahead; playback = how much is
     * needed before starting; rebuffer = how much after a stall. Memory stays capped by Media3's
     * default byte limit (size wins over time), so "Very large" can't exhaust a TV stick's RAM.
     */
    private static DefaultLoadControl loadControl(String size) {
        int min, max, start, rebuffer;
        switch (size == null ? "normal" : size) {
            case "small": min = 8000; max = 20000; start = 1000; rebuffer = 2000; break;
            case "large": min = 60000; max = 120000; start = 3000; rebuffer = 8000; break;
            case "xlarge": min = 120000; max = 240000; start = 5000; rebuffer = 15000; break;
            default: min = 30000; max = 50000; start = 2500; rebuffer = 5000;
        }
        return new DefaultLoadControl.Builder()
                .setBufferDurationsMs(min, max, start, rebuffer)
                .setPrioritizeTimeOverSizeThresholds(false)
                .build();
    }

    private void load(int index, long startMs) {
        pl.index = index;
        retries = 0;
        if (audioDisabled) {
            audioDisabled = false;
            player.setTrackSelectionParameters(player.getTrackSelectionParameters().buildUpon()
                    .setTrackTypeDisabled(C.TRACK_TYPE_AUDIO, false).build());
        }
        errorView.setVisibility(View.GONE);
        String url = pl.urls.get(index);
        MediaItem.Builder b = new MediaItem.Builder().setUri(url).setMediaId(pl.ids.get(index));
        String lower = url.toLowerCase(Locale.ROOT);
        if (lower.contains(".m3u8") || lower.contains("type=m3u8") || lower.contains("output=hls")) {
            b.setMimeType(MimeTypes.APPLICATION_M3U8);
        }
        player.setMediaItem(b.build(), startMs > 0 ? startMs : C.TIME_UNSET);
        player.prepare();
        player.setPlayWhenReady(true);
        showOverlay();
    }

    private void showOverlay() {
        String prefix = pl.live ? (pl.index + 1) + "   " : "";
        overlay.setText(prefix + pl.titles.get(pl.index));
        overlay.setVisibility(View.VISIBLE);
        handler.removeCallbacks(hideOverlay);
        handler.postDelayed(hideOverlay, 3500);
    }

    private void zap(int delta) {
        int n = pl.urls.size();
        if (n < 2) return;
        load(((pl.index + delta) % n + n) % n, 0);
    }

    /** Retry the current item (keeps the position for movies/series). */
    private void retry(long delayMs) {
        errorView.setText(getString(R.string.player_reconnecting));
        errorView.setVisibility(View.VISIBLE);
        handler.postDelayed(() -> {
            if (player == null) return;
            if (pl.live) player.seekToDefaultPosition();
            player.prepare();
            player.setPlayWhenReady(true);
        }, delayMs);
    }

    private void showError(String message) {
        handler.removeCallbacks(stallCheck);
        errorView.setText(message + "\n" + getString(R.string.player_error_hint));
        errorView.setVisibility(View.VISIBLE);
    }

    /** Stuck in "loading" with no error: the server accepted the request but sends nothing usable. */
    private void onStalled() {
        if (player == null || player.getPlaybackState() != Player.STATE_BUFFERING) return;
        if (retries < (pl.live ? 3 : 1)) {
            retries++;
            player.stop();
            retry(500);
        } else {
            player.stop();
            showError(getString(R.string.player_error_stall));
        }
    }

    private void handleError(PlaybackException error) {
        if (error.errorCode == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW) {
            player.seekToDefaultPosition();
            player.prepare();
            return;
        }

        // Decoder problems: retrying is pointless, say exactly what is unsupported.
        Format format = null;
        if (error instanceof ExoPlaybackException && ((ExoPlaybackException) error).type == ExoPlaybackException.TYPE_RENDERER) {
            format = ((ExoPlaybackException) error).rendererFormat;
        }
        boolean decoderError = format != null || (error.errorCode >= 4000 && error.errorCode < 5000);
        if (decoderError) {
            String mime = format != null && format.sampleMimeType != null ? format.sampleMimeType : "";
            if (mime.startsWith("audio/") && !audioDisabled) {
                // Unplayable audio track: play the picture without sound rather than nothing.
                audioDisabled = true;
                player.setTrackSelectionParameters(player.getTrackSelectionParameters().buildUpon()
                        .setTrackTypeDisabled(C.TRACK_TYPE_AUDIO, true).build());
                player.prepare();
                player.setPlayWhenReady(true);
                errorView.setText(getString(R.string.player_no_audio, describe(format)));
                errorView.setVisibility(View.VISIBLE);
                handler.removeCallbacks(hideError);
                handler.postDelayed(hideError, 6000);
                return;
            }
            showError(getString(R.string.player_error_codec, format != null ? describe(format) : error.getErrorCodeName()));
            return;
        }

        // The provider answered with an HTTP error: usually User-Agent, expired account or connection limit.
        HttpDataSource.InvalidResponseCodeException http = findCause(error, HttpDataSource.InvalidResponseCodeException.class);
        if (http != null) {
            if (pl.live && retries < 1 && http.responseCode >= 500) {
                retries++;
                retry(2000);
                return;
            }
            showError(getString(R.string.player_error_http, http.responseCode));
            return;
        }

        // Network / stream drops: retry a few times (live IPTV streams drop all the time).
        boolean network = error.errorCode >= 2000 && error.errorCode < 3000;
        if (network && retries < (pl.live ? 5 : 2)) {
            retries++;
            retry(1500L * retries);
            return;
        }
        showError(getString(R.string.player_error, error.getErrorCodeName()));
    }

    private static <T extends Throwable> T findCause(Throwable t, Class<T> type) {
        for (int i = 0; t != null && i < 10; i++, t = t.getCause()) {
            if (type.isInstance(t)) return type.cast(t);
        }
        return null;
    }

    /** "Dolby Digital Plus (E-AC-3)" style names for the formats IPTV users hit most. */
    private static String describe(Format f) {
        String m = f.sampleMimeType == null ? "" : f.sampleMimeType;
        String name;
        switch (m) {
            case MimeTypes.AUDIO_AC3: name = "Dolby Digital (AC-3) audio"; break;
            case MimeTypes.AUDIO_E_AC3: case MimeTypes.AUDIO_E_AC3_JOC: name = "Dolby Digital Plus (E-AC-3) audio"; break;
            case MimeTypes.AUDIO_AC4: name = "Dolby AC-4 audio"; break;
            case MimeTypes.AUDIO_TRUEHD: name = "Dolby TrueHD audio"; break;
            case MimeTypes.AUDIO_DTS: case MimeTypes.AUDIO_DTS_HD: case MimeTypes.AUDIO_DTS_EXPRESS: name = "DTS audio"; break;
            case MimeTypes.VIDEO_H265: name = "HEVC / H.265 video"; break;
            case MimeTypes.VIDEO_AV1: name = "AV1 video"; break;
            case MimeTypes.VIDEO_VP9: name = "VP9 video"; break;
            case MimeTypes.VIDEO_MPEG2: name = "MPEG-2 video"; break;
            default: name = m.isEmpty() ? "this format" : m;
        }
        if (f.width > 0 && f.height > 0) name += " " + f.width + "x" + f.height;
        return name;
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (event.getAction() != KeyEvent.ACTION_DOWN) return super.dispatchKeyEvent(event);
        boolean controls = view.isControllerFullyVisible();
        switch (event.getKeyCode()) {
            case KeyEvent.KEYCODE_BACK:
            case KeyEvent.KEYCODE_ESCAPE:
                if (controls) {
                    view.hideController();
                } else {
                    finishWithResult();
                }
                return true;
            case KeyEvent.KEYCODE_CHANNEL_UP:
            case KeyEvent.KEYCODE_PAGE_UP:
                zap(-1);
                return true;
            case KeyEvent.KEYCODE_CHANNEL_DOWN:
            case KeyEvent.KEYCODE_PAGE_DOWN:
                zap(1);
                return true;
            case KeyEvent.KEYCODE_DPAD_UP:
                if (!controls && pl.live) {
                    zap(-1);
                    return true;
                }
                break;
            case KeyEvent.KEYCODE_DPAD_DOWN:
                if (!controls && pl.live) {
                    zap(1);
                    return true;
                }
                break;
            case KeyEvent.KEYCODE_DPAD_LEFT:
                if (!controls && !pl.live) {
                    player.seekTo(Math.max(0, player.getCurrentPosition() - 10000));
                    view.showController();
                    return true;
                }
                break;
            case KeyEvent.KEYCODE_DPAD_RIGHT:
                if (!controls && !pl.live) {
                    player.seekTo(player.getCurrentPosition() + 10000);
                    view.showController();
                    return true;
                }
                break;
            case KeyEvent.KEYCODE_INFO:
            case KeyEvent.KEYCODE_GUIDE:
                showOverlay();
                return true;
            default:
                break;
        }
        return super.dispatchKeyEvent(event) || view.dispatchKeyEvent(event);
    }

    private void finishWithResult() {
        if (!resultSet && player != null) {
            Intent data = new Intent();
            data.putExtra("index", pl.index);
            data.putExtra("position", Math.max(0, player.getCurrentPosition()));
            long d = player.getDuration();
            data.putExtra("duration", d == C.TIME_UNSET ? 0 : d);
            setResult(RESULT_OK, data);
            resultSet = true;
        }
        finish();
    }

    @Override
    protected void onStop() {
        super.onStop();
        if (player != null) {
            if (!resultSet) {
                Intent data = new Intent();
                data.putExtra("index", pl.index);
                data.putExtra("position", Math.max(0, player.getCurrentPosition()));
                long d = player.getDuration();
                data.putExtra("duration", d == C.TIME_UNSET ? 0 : d);
                setResult(RESULT_OK, data);
            }
            player.setPlayWhenReady(false);
        }
        if (isFinishing()) release();
    }

    @Override
    protected void onStart() {
        super.onStart();
        if (player != null) player.setPlayWhenReady(true);
    }

    @Override
    protected void onDestroy() {
        release();
        super.onDestroy();
    }

    private void release() {
        handler.removeCallbacksAndMessages(null);
        if (player != null) {
            player.release();
            player = null;
        }
    }
}
