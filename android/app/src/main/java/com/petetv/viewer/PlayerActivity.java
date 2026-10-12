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
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultHttpDataSource;
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

    private final Runnable hideOverlay = () -> overlay.setVisibility(View.GONE);

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
        DefaultRenderersFactory renderers = new DefaultRenderersFactory(this).setEnableDecoderFallback(true);

        player = new ExoPlayer.Builder(this, renderers)
                .setMediaSourceFactory(new DefaultMediaSourceFactory(http, extractors))
                .build();
        player.addListener(new Player.Listener() {
            @Override
            public void onPlayerError(@NonNull PlaybackException error) {
                handleError(error);
            }

            @Override
            public void onPlaybackStateChanged(int state) {
                if (state == Player.STATE_READY) {
                    retries = 0;
                    errorView.setVisibility(View.GONE);
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

    private void load(int index, long startMs) {
        pl.index = index;
        retries = 0;
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

    private void handleError(PlaybackException error) {
        if (error.errorCode == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW) {
            player.seekToDefaultPosition();
            player.prepare();
            return;
        }
        // Live streams drop all the time on IPTV: retry a few times before giving up.
        if (retries < (pl.live ? 5 : 2)) {
            retries++;
            errorView.setText(getString(R.string.player_reconnecting));
            errorView.setVisibility(View.VISIBLE);
            handler.postDelayed(() -> {
                if (player != null) {
                    player.prepare();
                    player.setPlayWhenReady(true);
                }
            }, 1500L * retries);
            return;
        }
        errorView.setText(getString(R.string.player_error, error.getErrorCodeName()));
        errorView.setVisibility(View.VISIBLE);
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
