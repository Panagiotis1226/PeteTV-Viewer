import { useEffect, useState } from 'preact/hooks';
import { Logo } from '../components/Logo';
import { play } from '../player';
import { pop } from '../router';
import { getItem, historyEntry, isFavorite, state, toggleFavorite, useStore, xtreamFor } from '../store';
import type { SeriesInfo } from '../types';
import { fmtTime } from '../util';
import { userAgent } from './common';

export function SeriesDetail({ id }: { id: string }) {
  useStore();
  const it = getItem(id);
  const [info, setInfo] = useState<SeriesInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [season, setSeason] = useState<number | null>(null);

  useEffect(() => {
    if (!it) return;
    const x = xtreamFor();
    if (x && it.xid !== undefined) {
      x.seriesInfo(it.xid).then(setInfo).catch((e) => setError(e.message));
    } else {
      const episodes = state.library?.episodes?.[id] || [];
      setInfo({ episodes, seasons: [...new Set(episodes.map((e) => e.season))] });
    }
  }, [id]);

  if (!it) return <div class="screen"><button data-nav class="btn" onClick={() => pop()}>← Back</button></div>;
  const cur = season ?? info?.seasons[0] ?? 1;
  const eps = info ? info.episodes.filter((e) => e.season === cur) : [];

  const playEp = (index: number) => {
    const e = eps[index];
    const h = historyEntry(e.id);
    const resume = h?.position && h.duration && h.position < h.duration * 0.95 ? h.position : 0;
    play({
      kind: 'series',
      seriesId: it.id,
      items: eps.map((x) => ({ id: x.id, title: `S${x.season} E${x.episode} · ${x.title}`, url: x.url, logo: x.logo || it.logo })),
      index,
      startPosition: resume,
      userAgent: userAgent(),
    });
  };

  return (
    <div class="screen detail">
      <div class="detail-bg" style={info?.cover ? { backgroundImage: `url("${info.cover}")` } : undefined} />
      <header class="topbar">
        <button data-nav class="btn ghost" onClick={() => pop()} aria-label="Back">←</button>
        <h1>{it.name}</h1>
        <div class="grow" />
        <button data-nav class="btn" onClick={() => toggleFavorite(it.id)}>{isFavorite(it.id) ? '★ Favorited' : '☆ Favorite'}</button>
      </header>
      <div class="detail-body series">
        <div class="series-side">
          <Logo src={it.logo || info?.cover} name={it.name} class="detail-poster" />
          {[info?.year || it.year, info?.genre].filter(Boolean).length > 0 && <p class="muted small">{[info?.year || it.year, info?.genre].filter(Boolean).join(' · ')}</p>}
          {(info?.plot || it.plot) && <p class="plot small">{info?.plot || it.plot}</p>}
        </div>
        <div class="series-main">
          {error && <div class="banner error">{error}</div>}
          {!info && !error && <div class="spinner inline" />}
          {info && info.seasons.length > 1 && (
            <div class="seasons" data-nav-group="seasons">
              {info.seasons.map((n) => (
                <button key={n} data-nav data-nav-active={n === cur ? '' : undefined} class={'pill' + (n === cur ? ' active' : '')} onClick={() => setSeason(n)} onFocus={() => setSeason(n)}>
                  Season {n}
                </button>
              ))}
            </div>
          )}
          <div class="episodes" data-nav-group="eps">
            {info && eps.length === 0 && <div class="empty">No episodes found</div>}
            {eps.map((e, i) => {
              const h = historyEntry(e.id);
              const pct = h?.position && h.duration ? Math.min(100, (h.position / h.duration) * 100) : 0;
              return (
                <button key={e.id} data-nav data-nav-default={i === 0 ? '' : undefined} class="episode" onClick={() => playEp(i)}>
                  <span class="ep-num">E{e.episode}</span>
                  <span class="ep-title">{e.title}</span>
                  {h?.position ? <span class="muted small">{fmtTime(h.position)}</span> : e.duration ? <span class="muted small">{e.duration}</span> : null}
                  {pct > 0 && <span class="progress"><span style={{ width: `${pct}%` }} /></span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
