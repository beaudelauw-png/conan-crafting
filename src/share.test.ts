import { describe, expect, it } from 'vitest';
import { decodeShare, encodeShare, shareText } from './share';

describe('delen', () => {
  it('link heen en terug', () => {
    const s = { cart: [{ id: 'iron_bar', qty: 3 }], stock: { stone: 5 }, assign: { stone: 'Één' }, players: ['Één'] };
    expect(decodeShare(encodeShare(s))).toEqual(s);
    expect(decodeShare('#iets')).toBeNull();
    expect(decodeShare('#lijst=%7Bkapot')).toBeNull();
  });
  it('tekst per speler, zonder afgewerkte grondstoffen', () => {
    const rows = [
      { id: 'stone', needed: 10, fuel: 0, have: 0, missing: 10 },
      { id: 'wood', needed: 5, fuel: 0, have: 0, missing: 5 },
      { id: 'hide', needed: 2, fuel: 0, have: 2, missing: 0 },
    ];
    const t = shareText([{ id: 'x', qty: 1 }], rows, { stone: 'Ann' }, ['Ann', 'Bo'], (id) => id);
    expect(t).toBe('*Conan bouwlijst*\n1× x\n\n*Ann*\n• stone: 10\n\n*Niet toegewezen*\n• wood: 5');
  });
});
