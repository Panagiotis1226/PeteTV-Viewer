import { useState } from 'preact/hooks';

const COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f97316', '#10b981', '#06b6d4', '#eab308', '#ef4444'];

function initials(name: string): string {
  const clean = name.replace(/^[^|:]{1,6}[|:]\s*/, '').replace(/[^\p{L}\p{N} ]/gu, ' ').trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || '?') + (parts[1]?.[0] || '')).toUpperCase();
}

/** Image with a coloured-initials fallback (logos are often broken in IPTV lists). */
export function Logo({ src, name, class: cls }: { src?: string; name: string; class?: string }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    return <img class={cls} src={src} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onError={() => setFailed(true)} />;
  }
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return (
    <div class={(cls || '') + ' logo-fallback'} style={{ background: COLORS[Math.abs(h) % COLORS.length] }}>
      {initials(name)}
    </div>
  );
}
