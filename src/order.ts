/** Pure helpers for user ordering / hiding (unit tested). */

/**
 * Sort `list` by a saved custom order of ids. Ids not present in the saved
 * order keep their original relative position after the ordered ones
 * (so new provider categories show up at the end).
 */
export function applyOrder<T extends { id: string }>(list: T[], order: string[] | undefined): T[] {
  if (!order || !order.length) return list;
  const rank = new Map<string, number>();
  order.forEach((id, i) => rank.set(id, i));
  const ranked: T[] = [];
  const rest: T[] = [];
  for (const x of list) (rank.has(x.id) ? ranked : rest).push(x);
  ranked.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  return ranked.concat(rest);
}

/** Move id `id` by `delta` positions within the visible list and return the new full order. */
export function moveInOrder(currentIds: string[], id: string, delta: number): string[] {
  const ids = currentIds.slice();
  const i = ids.indexOf(id);
  if (i === -1) return ids;
  const j = Math.max(0, Math.min(ids.length - 1, i + delta));
  if (i === j) return ids;
  ids.splice(i, 1);
  ids.splice(j, 0, id);
  return ids;
}

export function toggle(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : list.concat(id);
}
