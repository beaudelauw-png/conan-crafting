import { useEffect, useMemo, useState } from 'react';
import itemData from '../data/items.json';
import fuelData from '../data/fuel.json';
import {
  buildTree, calculate, CartLine, formatTime, fuelTotals, gatherList, GatherRow, Item, ItemMap, Result,
  stationTotals, StationTotal, Stock, TreeNode,
} from './calc';
import { decodeShare, encodeShare, shareText } from './share';

const ITEMS = itemData as Item[];
const MAP: ItemMap = Object.fromEntries(ITEMS.map((i) => [i.id, i]));
const FUEL_STATIONS = fuelData.stations as Record<string, string[]>;
const DEFAULT_RATIOS = Object.fromEntries(fuelData.fuels.map((f) => [f.id, f.craftsPerUnit]));
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

async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); alert('Gekopieerd!'); } catch { prompt('Kopieer deze tekst:', text); }
}

const Unverified = ({ it }: { it?: Item }) =>
  it && !it.verified ? <span className="warn" title="Niet geverifieerd in de game">⚠</span> : null;

function Qty({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="qty">
      <button onClick={() => onChange(Math.max(0, value - 1))}>−</button>
      <NumInput value={value} onChange={onChange} />
      <button onClick={() => onChange(value + 1)}>+</button>
    </div>
  );
}

const NumInput = ({ value, onChange }: { value: number; onChange: (n: number) => void }) => (
  <input className="num" type="number" inputMode="numeric" min={0} value={value || ''} placeholder="0"
    onChange={(e) => onChange(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
);

type Tab = 'zoeken' | 'lijst' | 'resultaat' | 'instellingen';
type Calc = { res: Result; totals: Record<string, StationTotal>; rows: GatherRow[] } | { error: string };

export default function App() {
  const [tab, setTab] = useState<Tab>('zoeken');
  const [cart, setCart] = useStored<CartLine[]>('cart', []);
  const [stock, setStock] = useStored<Stock>('stock', {});
  const [checked, setChecked] = useStored<Record<string, boolean>>('checked', {});
  const [assign, setAssign] = useStored<Record<string, string>>('assign', {});
  const [players, setPlayers] = useStored<string[]>('players', ['Speler 1', 'Speler 2', 'Speler 3', 'Speler 4']);
  const [ratios, setRatios] = useStored<Record<string, number>>('fuelRatios', DEFAULT_RATIOS);
  const [stationFuel, setStationFuel] = useStored<Record<string, string>>('stationFuel', {});

  // Gedeelde lijst uit de link laden
  useEffect(() => {
    const s = decodeShare(location.hash);
    if (!s) return;
    history.replaceState(null, '', location.pathname + location.search);
    if (!confirm('Gedeelde bouwlijst laden? Je huidige lijst wordt vervangen.')) return;
    setCart(s.cart.filter((l) => MAP[l.id]));
    setStock(s.stock); setAssign(s.assign); setChecked({});
    if (s.players.length) setPlayers(s.players);
    setTab('resultaat');
  }, []);

  const calc = useMemo<Calc>(() => {
    try {
      const res = calculate(MAP, cart.filter((l) => MAP[l.id]), stock);
      const totals = stationTotals(MAP, res.crafts);
      return { res, totals, rows: gatherList(res, fuelTotals(totals, FUEL_STATIONS, ratios, stationFuel), stock) };
    } catch (e) { return { error: (e as Error).message }; }
  }, [cart, stock, ratios, stationFuel]);

  const setQty = (id: string, qty: number) =>
    setCart(cart.some((l) => l.id === id) ? cart.map((l) => (l.id === id ? { ...l, qty } : l)) : [...cart, { id, qty }]);
  const setHave = (id: string, n: number) => setStock({ ...stock, [id]: n });
  const count = cart.reduce((s, l) => s + l.qty, 0);

  const shareLink = () => {
    const url = location.href.split('#')[0] + encodeShare({ cart, stock, assign, players });
    if (navigator.share) navigator.share({ title: 'Conan bouwlijst', url }).catch(() => {});
    else copy(url);
  };
  const shareTxt = () => 'rows' in calc && copy(shareText(cart, calc.rows, assign, players, name));

  return (
    <div className="app">
      <main>
        {tab === 'zoeken' && <Search cart={cart} setQty={setQty} />}
        {tab === 'lijst' && (
          <Cart cart={cart} setCart={setCart} setQty={setQty} onLink={shareLink} onText={shareTxt} />
        )}
        {tab === 'resultaat' && (
          'error' in calc ? <p className="error">{calc.error}</p>
            : !count ? <p className="empty">Nog niets om te berekenen.</p>
              : <Results calc={calc} cart={cart} stock={stock} setHave={setHave}
                checked={checked} setChecked={setChecked} assign={assign} setAssign={setAssign} players={players} />
        )}
        {tab === 'instellingen' && (
          <Settings players={players} setPlayers={setPlayers} ratios={ratios} setRatios={setRatios}
            stationFuel={stationFuel} setStationFuel={setStationFuel} />
        )}
      </main>
      <nav>
        {(['zoeken', 'lijst', 'resultaat', 'instellingen'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {{ zoeken: '🔍 Zoeken', lijst: `📋 Lijst${count ? ` (${count})` : ''}`, resultaat: '⚒ Resultaat', instellingen: '⚙ Instellingen' }[t]}
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

function Cart({ cart, setCart, setQty, onLink, onText }: {
  cart: CartLine[]; setCart: (c: CartLine[]) => void; setQty: (id: string, n: number) => void;
  onLink: () => void; onText: () => void;
}) {
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
      <div className="two">
        <button onClick={onLink}>🔗 Deel als link</button>
        <button onClick={onText}>💬 Kopieer als tekst</button>
      </div>
      <button className="wide" onClick={() => confirm('Bouwlijst leegmaken?') && setCart([])}>Lijst leegmaken</button>
    </>
  );
}

function Results({ calc, cart, stock, setHave, checked, setChecked, assign, setAssign, players }: {
  calc: Exclude<Calc, { error: string }>; cart: CartLine[]; stock: Stock; setHave: (id: string, n: number) => void;
  checked: Record<string, boolean>; setChecked: (c: Record<string, boolean>) => void;
  assign: Record<string, string>; setAssign: (a: Record<string, string>) => void; players: string[];
}) {
  const [view, setView] = useState<'raw' | 'craft' | 'tree'>('raw');
  const { res, totals, rows } = calc;
  const todo = rows.filter((r) => r.missing > 0);
  const done = todo.filter((r) => checked[r.id]).length;
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
          <div className="progress"><div style={{ width: `${todo.length ? (done / todo.length) * 100 : 100}%` }} /></div>
          <p className="note">{todo.length ? `${done} van ${todo.length} verzameld` : 'Alles is binnen! ✅'}</p>
          <ul className="rows">
            {rows.map((r) => (
              <li key={r.id} className={`wrap ${r.missing === 0 || checked[r.id] ? 'done' : ''}`}>
                <input type="checkbox" className="check" checked={!!checked[r.id]} disabled={r.missing === 0}
                  onChange={(e) => setChecked({ ...checked, [r.id]: e.target.checked })} />
                <div className="grow">
                  <b>{name(r.id)}</b>
                  <small>nodig {r.needed + r.fuel}{r.fuel ? ` (waarvan ${r.fuel} brandstof)` : ''}</small>
                </div>
                <label className="have">kist<NumInput value={stock[r.id] ?? 0} onChange={(n) => setHave(r.id, n)} /></label>
                <b className="big">{r.missing}</b>
                {players.length > 0 && r.missing > 0 && (
                  <select className="player" value={assign[r.id] ?? ''} onChange={(e) => setAssign({ ...assign, [r.id]: e.target.value })}>
                    <option value="">— niemand —</option>
                    {players.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                )}
              </li>
            ))}
          </ul>
          {done > 0 && <button className="wide" onClick={() => setChecked({})}>Vinkjes wissen</button>}
        </>
      )}

      {view === 'craft' && Object.entries(totals).map(([st, t]) => (
        <section key={st}>
          <h3>{stationName(st)} <small>· {t.crafts} crafts{t.seconds ? ` · ${formatTime(t.seconds)}` : ''}{t.unknownTime ? ` (${t.unknownTime} recept(en) zonder tijd)` : ''}</small></h3>
          <ul className="rows">
            {Object.entries(res.crafts).filter(([id]) => (MAP[id].station ?? 'inventory') === st).map(([id, c]) => {
              const over = c.produced - (c.needed - c.have);
              return (
                <li key={id}>
                  <div className="grow">
                    <b>{name(id)}</b> <Unverified it={MAP[id]} />
                    <small>nodig {c.needed}{c.have ? `, ${c.have} uit kist` : ''} → {c.crafts}× craften{over ? ` (${over} over)` : ''}</small>
                    {MAP[id].tip && <small className="tip">💡 {MAP[id].tip}</small>}
                  </div>
                  <label className="have">kist<NumInput value={stock[id] ?? 0} onChange={(n) => setHave(id, n)} /></label>
                </li>
              );
            })}
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

function Settings({ players, setPlayers, ratios, setRatios, stationFuel, setStationFuel }: {
  players: string[]; setPlayers: (p: string[]) => void;
  ratios: Record<string, number>; setRatios: (r: Record<string, number>) => void;
  stationFuel: Record<string, string>; setStationFuel: (s: Record<string, string>) => void;
}) {
  return (
    <>
      <h3>Spelers</h3>
      <ul className="rows">
        {players.map((p, i) => (
          <li key={i}>
            <input className="grow text" value={p} onChange={(e) => setPlayers(players.map((x, j) => (j === i ? e.target.value : x)))} />
            <button className="del" onClick={() => setPlayers(players.filter((_, j) => j !== i))}>✕</button>
          </li>
        ))}
      </ul>
      <button className="wide" onClick={() => setPlayers([...players, `Speler ${players.length + 1}`])}>+ Speler</button>

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
        {Object.entries(FUEL_STATIONS).map(([st, opts]) => (
          <li key={st}>
            <div className="grow">{stationName(st)}</div>
            <select value={stationFuel[st] ?? opts[0]} onChange={(e) => setStationFuel({ ...stationFuel, [st]: e.target.value })}>
              {opts.map((o) => <option key={o} value={o}>{name(o)}</option>)}
            </select>
          </li>
        ))}
      </ul>
      <button className="wide" onClick={() => { setRatios(DEFAULT_RATIOS); setStationFuel({}); }}>Brandstof standaard</button>
    </>
  );
}
