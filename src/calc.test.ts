import { describe, expect, it } from 'vitest';
import { buildTree, calculate, CycleError, fuelNeeded, Item, ItemMap, stationTotals } from './calc';
import data from '../data/items.json';

const mk = (id: string, ing: Record<string, number> = {}, extra: Partial<Item> = {}): Item => ({
  id, name: id, category: 'x', station: Object.keys(ing).length ? 'furnace' : null,
  ingredients: Object.entries(ing).map(([id, qty]) => ({ id, qty })),
  yield: 1, time: null, level: null, feat: null, verified: false, ...extra,
});
const map = (...xs: Item[]): ItemMap => Object.fromEntries(xs.map((x) => [x.id, x]));

const items = map(
  mk('ore'), mk('tar'),
  mk('iron', { ore: 2 }, { time: 10 }),
  mk('steel', { iron: 1, tar: 1 }, { time: 20 }),
  mk('arrow', { iron: 1 }, { yield: 5, station: 'bench' }),
);

describe('calculate', () => {
  it('rekent recursief terug tot ruwe grondstoffen', () => {
    const r = calculate(items, [{ id: 'steel', qty: 3 }]);
    expect(r.raw).toEqual({ ore: 6, tar: 3 });
    expect(r.crafts.iron.crafts).toBe(3);
  });

  it('rondt af naar hele crafts', () => {
    const r = calculate(items, [{ id: 'arrow', qty: 7 }]);
    expect(r.crafts.arrow).toEqual({ crafts: 2, needed: 7, produced: 10 });
    expect(r.raw.ore).toBe(4);
  });

  it('telt vraag eerst op voor het afronden', () => {
    const r = calculate(items, [{ id: 'arrow', qty: 3 }, { id: 'arrow', qty: 3 }]);
    expect(r.crafts.arrow.crafts).toBe(2);
  });

  it('negeert aantallen 0', () => {
    expect(calculate(items, [{ id: 'steel', qty: 0 }]).raw).toEqual({});
  });

  it('detecteert recepten die naar elkaar verwijzen', () => {
    const loop = map(mk('a', { b: 1 }), mk('b', { a: 1 }));
    expect(() => calculate(loop, [{ id: 'a', qty: 1 }])).toThrow(CycleError);
    expect(buildTree(loop, 'a', 1).children[0].children[0].cycle).toBe(true);
  });
});

describe('stations en brandstof', () => {
  it('telt tijd per station', () => {
    const r = calculate(items, [{ id: 'steel', qty: 2 }]);
    expect(stationTotals(items, r.crafts).furnace).toEqual({ crafts: 4, seconds: 60, unknownTime: 0 });
  });
  it('rondt brandstof naar boven af', () => {
    expect(fuelNeeded(7, { id: 'coal', craftsPerUnit: 3 })).toBe(3);
    expect(fuelNeeded(4, { id: 'branch', craftsPerUnit: 0.5 })).toBe(8);
  });
});

describe('dataset', () => {
  const all = map(...(data as Item[]));
  it('alle ingrediënten en stations bestaan en er zijn geen lussen', () => {
    for (const it of data as Item[]) {
      for (const g of it.ingredients) expect(all[g.id], `${it.id} → ${g.id}`).toBeDefined();
      if (it.station && it.station !== 'inventory') expect(all[it.station], it.station).toBeDefined();
    }
    expect(() => calculate(all, (data as Item[]).map((i) => ({ id: i.id, qty: 1 })))).not.toThrow();
  });
});
