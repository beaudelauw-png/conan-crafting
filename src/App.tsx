import { useEffect, useMemo, useState } from 'react';
import itemData from '../data/items.json';
import fuelData from '../data/fuel.json';
import {
  buildTree, calculate, CartLine, formatTime, fuelNeeded, Item, ItemMap, Result, stationTotals, TreeNode,
} from './calc';

const ITEMS = itemData as Item[];
const MAP: ItemMap = Object.fromEntries(ITEMS.map((i) => [i.id, i]));
const CATS: Record<string, string> = {
  building: 'Bouwen', stations: 'Stations', tools: 'Gereedschap', weapons: 'Wapens', armor: 'Armor',
  consumables: 'Consumables', thralls: 'Thralls/Pets', intermediates: 'Tussenproducten', resources: 'Grondstoffen',
};
const name = (id: string) => MAP[id]?.name ?? id;
const stationName = (id: string) => (id === 'inventory' ? 'Inventaris' : name(id));

function useStored<T>(key: string, init: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : init; } catch { return init; }
  });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* geen opslag */ } }, [key, v]);
  return [v, setV];
}

const Unverified = ({ it }: { it?: Item }) =>
  it && !it.verified ? <span className="warn" title="Niet geverifieerd in de game">⚠</span> : null;

function Qty({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="qty">
      <button onClick={() => onChange(Math.max(0, value - 1))}>−</button>
      <input type="number" inputMode="numeric" min={0} value={value}
        onChange={(e) => onChange(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
      <button onClick={() => onChange(value + 1)}>+</button>
    </div>
  );
}

type Tab = 'zoeken' | 'lijst' | 'resultaat' | 'brandstof';

export default function App() {
  const [tab, setTab] = useState<Tab>('zoeken');
  const [cart, setCart] = useStored<CartLine[]>('cart', []);
  const [ratios, setRatios] = useStored<Record<string, number>>('fuelRatios',
    Object.fromEntries(fuelData.fuels.map((f) => [f.id, f.craftsPerUnit])));
  const [stationFuel, setStationFuel] = useStored<Record<string, string>>('stationFuel', {});

  const setQty = (id: string, qty: number) =>
    setCart(cart.some((l) => l.id === id)
      ? cart.map((l) => (l.id === id ? { ...l, qty } : l))
      : [...cart, { id, qty }]);
  const count = cart.reduce((s, l) => s + l.qty, 0);

  return (
    <div className="app">
      <main>
        {tab === 'zoeken' && <Search cart={cart} setQty={setQty} />}
        {tab === 'lijst' && <Cart cart={cart} setCart={setCart} setQty={setQty} />}
        {tab === 'resultaat' && <Results cart={cart} ratios={ratios} stationFuel={stationFuel} />}
        {tab === 'brandstof' && (
          <FuelSettings ratios={ratios} setRatios={setRatios} stationFuel={stationFuel} setStationFuel={setStationFuel} />
        )}
      </main>
      <nav>
        {(['zoeken', 'lijst', 'resultaat', 'brandstof'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {{ zoeken: '🔍 Zoeken', lijst: `📋 Lijst${count ? ` (${count})` : ''}`, resultaat: '⚒ Resultaat', brandstof: '🔥 Brandstof' }[t]}
          </button>
        ))}
      </nav>
    </div>
  );
}

function Search({ cart, setQty }: { cart: CartLine[]; setQty: (id: string, n: number) => void }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const list = ITEMS.filter((i) => (!cat || i.category === cat) && i.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <input className="search" placeholder="Zoek item…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="chips">
        <button className={!cat ? 'on' : ''} onClick={() => setCat('')}>Alles</button>
        {Object.entries(CATS).map(([k, v]) => (
          <button key={k} className={cat === k ? 'on' : ''} onClick={() => setCat(k)}>{v}</button>
        ))}
      </div>
      <ul className="rows">
        {list.map((i) => {
          const inCart = cart.find((l) => l.id === i.id)?.qty ?? 0;
          return (
            <li key={i.id}>
              <div className="grow">
                <b>{i.name}</b> <Unverified it={i} />
                <small>{i.station ? stationName(i.station) : 'Grondstof'} · {i.ingredients.map((g) => `${g.qty}× ${name(g.id)}`).join(', ') || 'verzamelen'}</small>
              </div>
              {inCart ? <Qty value={inCart} onChange={(n) => setQty(i.id, n)} />
                : <button className="add" onClick={() => setQty(i.id, 1)}>+</button>}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function Cart({ cart, setCart, setQty }: { cart: CartLine[]; setCart: (c: CartLine[]) => void; setQty: (id: string, n: number) => void }) {
  if (!cart.length) return <p className="empty">Bouwlijst is leeg. Voeg items toe via Zoeken.</p>;
  return (
    <>
      <ul className="rows">
        {cart.map((l) => (
          <li key={l.id}>
            <div className="grow"><b>{name(l.id)}</b> <Unverified it={MAP[l.id]} /></div>
            <Qty value={l.qty} onChange={(n) => setQty(l.id, n)} />
            <button className="del" onClick={() => setCart(cart.filter((x) => x.id !== l.id))}>✕</button>
          </li>
        ))}
      </ul>
      <button className="wide" onClick={() => confirm('Bouwlijst leegmaken?') && setCart([])}>Lijst leegmaken</button>
    </>
  );
}

function Results({ cart, ratios, stationFuel }: { cart: CartLine[]; ratios: Record<string, number>; stationFuel: Record<string, string> }) {
  const [view, setView] = useState<'raw' | 'craft' | 'tree'>('raw');
  const res = useMemo<Result | string>(() => {
    try { return calculate(MAP, cart.filter((l) => MAP[l.id])); } catch (e) { return (e as Error).message; }
  }, [cart]);
  if (typeof res === 'string') return <p className="error">{res}</p>;
  if (!cart.some((l) => l.qty > 0)) return <p className="empty">Nog niets om te berekenen.</p>;

  const totals = stationTotals(MAP, res.crafts);
  const fuel: Record<string, number> = {};
  for (const [st, t] of Object.entries(totals)) {
    const opts = (fuelData.stations as Record<string, string[]>)[st];
    if (!opts) continue;
    const f = stationFuel[st] ?? opts[0];
    fuel[f] = (fuel[f] ?? 0) + fuelNeeded(t.crafts, { id: f, craftsPerUnit: ratios[f] ?? 1 });
  }
  const anyUnverified = [...Object.keys(res.crafts), ...Object.keys(res.raw)].some((id) => !MAP[id].verified);

  return (
    <>
      <div className="chips">
        <button className={view === 'raw' ? 'on' : ''} onClick={() => setView('raw')}>Verzamelen</button>
        <button className={view === 'craft' ? 'on' : ''} onClick={() => setView('craft')}>Craften</button>
        <button className={view === 'tree' ? 'on' : ''} onClick={() => setView('tree')}>Boom</button>
      </div>
      {anyUnverified && <p className="note">⚠ = recept niet geverifieerd, controleer in de game.</p>}

      {view === 'raw' && (
        <>
          <h3>Ruwe grondstoffen</h3>
          <ul className="rows">
            {Object.entries(res.raw).sort((a, b) => b[1] - a[1]).map(([id, n]) => (
              <li key={id}><div className="grow">{name(id)}</div><b>{n}</b></li>
            ))}
          </ul>
          {Object.keys(fuel).length > 0 && (
            <>
              <h3>Brandstof (extra)</h3>
              <ul className="rows">
                {Object.entries(fuel).map(([id, n]) => (
                  <li key={id}><div className="grow">{name(id)}</div><b>{n}</b></li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {view === 'craft' && Object.entries(totals).map(([st, t]) => (
        <section key={st}>
          <h3>{stationName(st)} <small>· {t.crafts} crafts · {t.seconds ? formatTime(t.seconds) : ''}{t.unknownTime ? ` (${t.unknownTime} recept(en) zonder tijd)` : ''}</small></h3>
          <ul className="rows">
            {Object.entries(res.crafts).filter(([id]) => (MAP[id].station ?? 'inventory') === st).map(([id, c]) => (
              <li key={id}>
                <div className="grow">
                  <b>{name(id)}</b> <Unverified it={MAP[id]} />
                  <small>{c.crafts}× craften → {c.produced} stuks{c.produced > c.needed ? ` (${c.produced - c.needed} over)` : ''}</small>
                  {MAP[id].tip && <small className="tip">💡 {MAP[id].tip}</small>}
                </div>
                <b>{c.needed}</b>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {view === 'tree' && (
        <ul className="tree">
          {cart.filter((l) => l.qty > 0 && MAP[l.id]).map((l) => <Tree key={l.id} node={buildTree(MAP, l.id, l.qty)} />)}
        </ul>
      )}
    </>
  );
}

function Tree({ node }: { node: TreeNode }) {
  const label = <>{node.qty}× {name(node.id)} <Unverified it={MAP[node.id]} />
    {node.crafts > 0 && <small> ({node.crafts} crafts, {stationName(MAP[node.id].station!)})</small>}
    {node.cycle && <span className="error"> lus!</span>}</>;
  if (!node.children.length) return <li className="leaf">{label}</li>;
  return (
    <li><details open><summary>{label}</summary>
      <ul>{node.children.map((c) => <Tree key={c.id} node={c} />)}</ul>
    </details></li>
  );
}

function FuelSettings({ ratios, setRatios, stationFuel, setStationFuel }: {
  ratios: Record<string, number>; setRatios: (r: Record<string, number>) => void;
  stationFuel: Record<string, string>; setStationFuel: (s: Record<string, string>) => void;
}) {
  return (
    <>
      <h3>Verhouding per brandstof</h3>
      <p className="note">Aantal crafts per 1 eenheid brandstof. ⚠ Standaardwaarden zijn niet geverifieerd.</p>
      <ul className="rows">
        {fuelData.fuels.map((f) => (
          <li key={f.id}>
            <div className="grow">{name(f.id)}</div>
            <input className="num" type="number" inputMode="decimal" step="0.1" min={0} value={ratios[f.id] ?? f.craftsPerUnit}
              onChange={(e) => setRatios({ ...ratios, [f.id]: Number(e.target.value) || 0 })} />
          </li>
        ))}
      </ul>
      <h3>Brandstof per station</h3>
      <ul className="rows">
        {Object.entries(fuelData.stations as Record<string, string[]>).map(([st, opts]) => (
          <li key={st}>
            <div className="grow">{stationName(st)}</div>
            <select value={stationFuel[st] ?? opts[0]} onChange={(e) => setStationFuel({ ...stationFuel, [st]: e.target.value })}>
              {opts.map((o) => <option key={o} value={o}>{name(o)}</option>)}
            </select>
          </li>
        ))}
      </ul>
      <button className="wide" onClick={() => { setRatios(Object.fromEntries(fuelData.fuels.map((f) => [f.id, f.craftsPerUnit]))); setStationFuel({}); }}>
        Standaardwaarden
      </button>
    </>
  );
}
