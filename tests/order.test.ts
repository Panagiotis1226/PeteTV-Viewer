import { describe, expect, it } from 'vitest';
import { applyOrder, moveInOrder, toggle } from '../src/order';

const L = ['a', 'b', 'c', 'd'].map((id) => ({ id }));

describe('ordering', () => {
  it('keeps provider order without custom order', () => expect(applyOrder(L, undefined)).toBe(L));
  it('applies saved order and appends unknown ids', () => {
    expect(applyOrder(L, ['c', 'a', 'zzz']).map((x) => x.id)).toEqual(['c', 'a', 'b', 'd']);
  });
  it('moves items up/down and clamps', () => {
    expect(moveInOrder(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b']);
    expect(moveInOrder(['a', 'b', 'c'], 'a', -5)).toEqual(['a', 'b', 'c']);
    expect(moveInOrder(['a', 'b', 'c'], 'a', 10)).toEqual(['b', 'c', 'a']);
    expect(moveInOrder(['a', 'b', 'c'], 'c', -2)).toEqual(['c', 'a', 'b']);
  });
  it('toggles ids', () => {
    expect(toggle(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggle(['a', 'b'], 'a')).toEqual(['b']);
  });
});
