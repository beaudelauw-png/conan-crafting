export interface Ingredient { id: string; qty: number }
export interface Item {
  id: string;
  name: string;
  category: string;
  station: string | null; // null = ruwe grondstof, 'inventory' = zonder station
  ingredients: Ingredient[];
  yield: number;
  time: number | null; // seconden per craft
  level: number | null;
  feat: string | null;
  tip?: string;
  verified: boolean;
}
export type ItemMap = Record<string, Item>;
export interface CartLine { id: string; qty: number }
export interface CraftInfo { crafts: number; needed: number; produced: number }
export interface Result { raw: Record<string, number>; crafts: Record<string, CraftInfo> }
export interface FuelDef { id: string; craftsPerUnit: number }

export class CycleError extends Error {
  constructor(public path: string[]) {
    super(`Recepten verwijzen naar elkaar: ${path.join(' → ')}`);
  }
}

export const isRaw = (it: Item) => it.ingredients.length === 0;

/** Ouders vóór kinderen, zodat de totale vraag naar een tussenproduct bekend is vóór we afronden. */
export function topoOrder(items: ItemMap, roots: string[]): string[] {
  const state = new Map<string, 1 | 2>();
  const out: string[] = [];
  const visit = (id: string, path: string[]) => {
    const s = state.get(id);
    if (s === 2) return;
    if (s === 1) throw new CycleError([...path, id]);
    const it = items[id];
    if (!it) throw new Error(`Onbekend item: ${id}`);
    state.set(id, 1);
    for (const ing of it.ingredients) visit(ing.id, [...path, id]);
    state.set(id, 2);
    out.push(id);
  };
  roots.forEach((r) => visit(r, []));
  return out.reverse();
}

export function calculate(items: ItemMap, cart: CartLine[]): Result {
  const demand: Record<string, number> = {};
  for (const l of cart) if (l.qty > 0) demand[l.id] = (demand[l.id] ?? 0) + l.qty;
  const raw: Record<string, number> = {};
  const crafts: Record<string, CraftInfo> = {};
  for (const id of topoOrder(items, Object.keys(demand))) {
    const need = demand[id] ?? 0;
    if (!need) continue;
    const it = items[id];
    if (isRaw(it)) { raw[id] = need; continue; }
    const n = Math.ceil(need / Math.max(1, it.yield));
    crafts[id] = { crafts: n, needed: need, produced: n * it.yield };
    for (const ing of it.ingredients) demand[ing.id] = (demand[ing.id] ?? 0) + ing.qty * n;
  }
  return { raw, crafts };
}

export interface StationTotal { crafts: number; seconds: number; unknownTime: number }

export function stationTotals(items: ItemMap, crafts: Record<string, CraftInfo>): Record<string, StationTotal> {
  const out: Record<string, StationTotal> = {};
  for (const [id, c] of Object.entries(crafts)) {
    const it = items[id];
    const st = (out[it.station ?? 'inventory'] ??= { crafts: 0, seconds: 0, unknownTime: 0 });
    st.crafts += c.crafts;
    if (it.time == null) st.unknownTime++;
    else st.seconds += it.time * c.crafts;
  }
  return out;
}

/** Aantal brandstofeenheden voor een aantal crafts, naar boven afgerond. */
export const fuelNeeded = (crafts: number, fuel: FuelDef) =>
  fuel.craftsPerUnit > 0 ? Math.ceil(crafts / fuel.craftsPerUnit) : 0;

export interface TreeNode { id: string; qty: number; crafts: number; children: TreeNode[]; cycle?: boolean }

/** Boom per item; elke tak wordt apart afgerond (alleen voor weergave). */
export function buildTree(items: ItemMap, id: string, qty: number, path: string[] = []): TreeNode {
  const it = items[id];
  if (!it || path.includes(id)) return { id, qty, crafts: 0, children: [], cycle: !!it };
  if (isRaw(it)) return { id, qty, crafts: 0, children: [] };
  const n = Math.ceil(qty / Math.max(1, it.yield));
  return {
    id, qty, crafts: n,
    children: it.ingredients.map((g) => buildTree(items, g.id, g.qty * n, [...path, id])),
  };
}

export const formatTime = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.round(s % 60);
  return h ? `${h}u ${m}m` : m ? `${m}m ${sec}s` : `${sec}s`;
};
