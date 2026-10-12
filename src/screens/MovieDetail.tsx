import { useEffect, useState } from 'preact/hooks';
import { Logo } from '../components/Logo';
import { pop } from '../router';
import { getItem, historyEntry, isFavorite, toggleFavorite, useStore, xtreamFor } from '../store';
import type { MovieInfo } from '../types';
import { fmtTime } from '../util';
import { playMovie } from './common';

export function MovieDetail({ id }: { id: string }) {
  useStore();
  const it = getItem(id);
  const [info, setInfo] = useState<MovieInfo | null>(null);
  useEffect(() => {
    const x = xtreamFor();
    if (it && x && it.xid !== undefined) x.movieInfo(it.xid).then(setInfo).catch(() => {});
  }, [id]);
  if (!it) return <div class="screen"><button data-nav class="btn" onClick={() => pop()}>← Back</button></div>;
  const h = historyEntry(id);
  const resume = h?.position && h.duration && h.position < h.duration * 0.95 ? h.position : 0;
  const meta = [info?.year || it.year, info?.duration, info?.genre].filter(Boolean).join(' · ');
  const rating = info?.rating || it.rating;
  return (
    <div class="screen detail">
      <div class="detail-bg" style={info?.cover ? { backgroundImage: `url("${info.cover}")` } : undefined} />
      <header class="topbar">
        <button data-nav class="btn ghost" onClick={() => pop()} aria-label="Back">←</button>
      </header>
      <div class="detail-body">
        <Logo src={it.logo || info?.cover} name={it.name} class="detail-poster" />
        <div class="detail-text">
          <h1>{it.name}</h1>
          {meta && <p class="muted">{meta}</p>}
          {rating && Number(rating) > 0 ? <p class="rating">★ {Number(rating).toFixed(1)}</p> : null}
          <div class="row gap">
            {resume > 0 && (
              <button data-nav data-nav-default class="btn primary lg" onClick={() => playMovie(it, resume)}>▶ Resume {fmtTime(resume)}</button>
            )}
            <button data-nav data-nav-default={resume ? undefined : ''} class={'btn lg' + (resume ? '' : ' primary')} onClick={() => playMovie(it, 0)}>
              {resume ? '↺ Start over' : '▶ Play'}
            </button>
            <button data-nav class="btn lg" onClick={() => toggleFavorite(it.id)}>{isFavorite(it.id) ? '★ Favorited' : '☆ Favorite'}</button>
          </div>
          {(info?.plot || it.plot) && <p class="plot">{info?.plot || it.plot}</p>}
          {info?.cast && <p class="muted small">Cast: {info.cast}</p>}
          {info?.director && <p class="muted small">Director: {info.director}</p>}
        </div>
      </div>
    </div>
  );
}
