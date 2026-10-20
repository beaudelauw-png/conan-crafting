import type { CartLine, GatherRow, Stock } from './calc';

export interface Shared { cart: CartLine[]; stock: Stock; assign: Record<string, string>; players: string[] }

const KEY = '#lijst=';

export const encodeShare = (s: Shared) => KEY + encodeURIComponent(JSON.stringify(s));

export function decodeShare(hash: string): Shared | null {
  if (!hash.startsWith(KEY)) return null;
  try {
    const s = JSON.parse(decodeURIComponent(hash.slice(KEY.length)));
    if (!Array.isArray(s.cart)) return null;
    return { cart: s.cart, stock: s.stock ?? {}, assign: s.assign ?? {}, players: s.players ?? [] };
  } catch {
    return null;
  }
}

/** Tekst voor WhatsApp: *vet* koppen, per speler wat er nog ontbreekt. */
export function shareText(
  cart: CartLine[], rows: GatherRow[], assign: Record<string, string>, players: string[], name: (id: string) => string,
): string {
  const out = ['*Conan bouwlijst*', ...cart.filter((l) => l.qty > 0).map((l) => `${l.qty}× ${name(l.id)}`), ''];
  const todo = rows.filter((r) => r.missing > 0);
  const groups = [...players, ''];
  for (const p of groups) {
    const mine = todo.filter((r) => (players.includes(assign[r.id]) ? assign[r.id] : '') === p);
    if (!mine.length) continue;
    out.push(`*${p || 'Niet toegewezen'}*`, ...mine.map((r) => `• ${name(r.id)}: ${r.missing}`), '');
  }
  if (!todo.length) out.push('Alles is binnen! ✅');
  return out.join('\n').trim();
}
