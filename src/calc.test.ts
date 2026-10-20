import { describe, expect, it } from 'vitest';
import { buildTree, calculate, combineMods, CycleError, fuelNeeded, fuelTotals, gatherList, gatherMinutes, Item, ItemMap, stationTotals } from './calc';
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
    expect(r.raw.ore.missing).toBe(6);
    expect(r.raw.tar.missing).toBe(3);
    expect(r.crafts.iron.crafts).toBe(3);
  });

  it('rondt af naar hele crafts', () => {
    const r = calculate(items, [{ id: 'arrow', qty: 7 }]);
    expect(r.crafts.arrow).toEqual({ crafts: 2, needed: 7, have: 0, produced: 10 });
    expect(r.raw.ore.missing).toBe(4);
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

describe('voorraad', () => {
  it('trekt ruwe voorraad af', () => {
    const r = calculate(items, [{ id: 'steel', qty: 3 }], { ore: 4, tar: 10 });
    expect(r.raw.ore).toEqual({ needed: 6, have: 4, missing: 2 });
    expect(r.raw.tar).toEqual({ needed: 3, have: 3, missing: 0 });
  });
  it('voorraad tussenproduct vermindert crafts en ingrediënten', () => {
    const r = calculate(items, [{ id: 'steel', qty: 3 }], { iron: 2 });
    expect(r.crafts.iron).toMatchObject({ crafts: 1, have: 2 });
    expect(r.raw.ore.missing).toBe(2);
  });
  it('voorraad wordt afgetrokken vóór afronden', () => {
    expect(calculate(items, [{ id: 'arrow', qty: 7 }], { arrow: 3 }).crafts.arrow.crafts).toBe(1);
  });
  it('verzamellijst telt brandstof mee', () => {
    const r = calculate(items, [{ id: 'steel', qty: 2 }]);
    const fuel = fuelTotals(stationTotals(items, r.crafts), { furnace: ['ore'] }, { ore: 2 }, {});
    expect(fuel).toEqual({ ore: 2 });
    expect(gatherList(r, fuel, { ore: 1 }).find((g) => g.id === 'ore')).toEqual({ id: 'ore', needed: 4, fuel: 2, have: 1, missing: 5 });
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

describe('multipliers en bonussen', () => {
  const m = (time = 0, material = 0, fuel = 0) => ({ time, material, fuel });
  it('combineert besparingen multiplicatief', () => {
    expect(combineMods(m(0.2), m(0.1)).time).toBeCloseTo(0.28);
  });
  it('crafting-tijd multiplier en thrallbonus', () => {
    const r = calculate(items, [{ id: 'steel', qty: 2 }]);
    const t = stationTotals(items, r.crafts, { furnace: m(0.5) }, { craftTime: 0.5, harvest: 1, fuelBurn: 1 });
    expect(t.furnace.seconds).toBe(15);
  });
  it('materiaalbesparing rondt naar boven af op het totaal', () => {
    const r = calculate(items, [{ id: 'iron', qty: 3 }], {}, { furnace: m(0, 0.25) });
    expect(r.raw.ore.missing).toBe(5); // 6 × 0.75 = 4.5 → 5
  });
  it('brandtijd en brandstofbesparing', () => {
    const totals = { furnace: { crafts: 10, seconds: 0, unknownTime: 0 } };
    expect(fuelTotals(totals, { furnace: ['wood'] }, { wood: 1 }, {}, {}, 2)).toEqual({ wood: 5 });
    expect(fuelTotals(totals, { furnace: ['wood'] }, { wood: 1 }, {}, { furnace: m(0, 0, 0.5) })).toEqual({ wood: 5 });
  });
  it('verzameltijd met harvest multiplier', () => {
    expect(gatherMinutes(120, 60, 2)).toBe(1);
    expect(gatherMinutes(10, undefined, 1)).toBeNull();
  });
});
