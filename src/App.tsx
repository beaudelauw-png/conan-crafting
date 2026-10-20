import { useEffect, useMemo, useState } from 'react';
import itemData from '../data/items.json';
import fuelData from '../data/fuel.json';
import bonusData from '../data/bonuses.json';
import gatherData from '../data/gather.json';
import {
  buildTree, calculate, CartLine, combineMods, DEFAULT_SERVER, formatTime, fuelTotals, gatherList, gatherMinutes,
  GatherRow, Item, ItemMap, Mods, Result, Server, StationMods, stationTotals, StationTotal, Stock, TreeNode,
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
const STATIONS = [...new Set(ITEMS.map((i) => i.station).filter((s): s is string => !!s && s !== 'inventory'))];
const RATES = gatherData.rates as Record<string, number>;

type Bonus = { thrall?: string; upgrade?: boolean };
const pct = (b: { time: number; material: number; fuel: number }): Mods =>
  ({ time: b.time / 100, material: b.material / 100, fuel: b.fuel / 100 });

/** Bonussen per station uit de gekozen thrall en/of het betere station. */
function buildMods(sel: Record<string, Bonus>): { mods: StationMods; label: (st: string) => string } {
  const mods: StationMods = {};
  const names: Record<string, string> = {};
  for (const [st, b] of Object.entries(sel)) {
    const list: Mods[] = [];
    const t = bonusData.thralls.find((x) => x.id === b.thrall);
    if (t) list.push(pct(t));
    const u = b.upgrade && bonusData.upgrades.find((x) => x.station === st);
    if (u) { list.push(pct(u)); names[st] = name(u.to); }
    if (list.length) mods[st] = combineMods(...list);
    if (t) names[st] = `${names[st] ?? stationName(st)} + ${t.label}`;
  }
  return { mods, label: (st) => names[st] ?? stationName(st) };
}
const fmtMin = (m: number) => (m < 1 ? '<1 min' : m < 90 ? `±${Math.round(m)} min` : `±${(m / 60).toFixed(1)} u`);

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
type Calc = { res: Result; totals: Record<string, StationTotal>; rows: GatherRow[]; label: (st: string) => string; harvest: number }
  | { error: string };

export default function App() {
  const [tab, setTab] = useState<Tab>('zoeken');
  const [cart, setCart] = useStored<CartLine[]>('cart', []);
  const [stock, setStock] = useStored<Stock>('stock', {});
  const [checked, setChecked] = useStored<Record<string, boolean>>('checked', {});
  const [assign, setAssign] = useStored<Record<string, string>>('assign', {});
  const [players, setPlayers] = useStored<string[]>('players', ['Speler 1', 'Speler 2', 'Speler 3', 'Speler 4']);
  const [ratios, setRatios] = useStored<Record<string, number>>('fuelRatios', DEFAULT_RATIOS);
  const [stationFuel, setStationFuel] = useStored<Record<string, string>>('stationFuel', {});
  const [server, setServer] = useStored<Server>('server', DEFAULT_SERVER);
  const [bonus, setBonus] = useStored<Record<string, Bonus>>('bonus', {});

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
      const { mods, label } = buildMods(bonus);
      const res = calculate(MAP, cart.filter((l) => MAP[l.id]), stock, mods);
      const totals = stationTotals(MAP, res.crafts, mods, server);
      const fuel = fuelTotals(totals, FUEL_STATIONS, ratios, stationFuel, mods, server.fuelBurn);
      return { res, totals, rows: gatherList(res, fuel, stock), label, harvest: server.harvest };
    } catch (e) { return { error: (e as Error).message }; }
  }, [cart, stock, ratios, stationFuel, bonus, server]);

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
          <Settings server={server} setServer={setServer} bonus={bonus} setBonus={setBonus}
            players={players} setPlayers={setPlayers} ratios={ratios} setRatios={setRatios}
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
  const { res, totals, rows, label, harvest } = calc;
  const mins = (r: GatherRow) => gatherMinutes(r.missing, RATES[r.id], harvest);
  const perPlayer: Record<string, number> = {};
  for (const r of rows) if (r.missing && !checked[r.id]) {
    const k = players.includes(assign[r.id]) ? assign[r.id] : 'Niet toegewezen';
    perPlayer[k] = (perPlayer[k] ?? 0) + (mins(r) ?? 0);
  }
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
          {Object.keys(perPlayer).length > 0 && (
            <p className="note">⏱ Ruwe schatting verzameltijd: {Object.entries(perPlayer).map(([p, m]) => `${p} ${fmtMin(m)}`).join(' · ')}</p>
          )}
          <ul className="rows">
            {rows.map((r) => (
              <li key={r.id} className={`wrap ${r.missing === 0 || checked[r.id] ? 'done' : ''}`}>
                <input type="checkbox" className="check" checked={!!checked[r.id]} disabled={r.missing === 0}
                  onChange={(e) => setChecked({ ...checked, [r.id]: e.target.checked })} />
                <div className="grow">
                  <b>{name(r.id)}</b>
                  <small>nodig {r.needed + r.fuel}{r.fuel ? ` (waarvan ${r.fuel} brandstof)` : ''}
                    {r.missing > 0 && mins(r) != null && ` · ${fmtMin(mins(r)!)} (schatting)`}</small>
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
          <h3>{label(st)} <small>· {t.crafts} crafts{t.seconds ? ` · ${formatTime(t.seconds)}` : ''}{t.unknownTime ? ` (${t.unknownTime} recept(en) zonder tijd)` : ''}</small></h3>
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

function Settings({ server, setServer, bonus, setBonus, players, setPlayers, ratios, setRatios, stationFuel, setStationFuel }: {
  server: Server; setServer: (s: Server) => void; bonus: Record<string, Bonus>; setBonus: (b: Record<string, Bonus>) => void;
  players: string[]; setPlayers: (p: string[]) => void;
  ratios: Record<string, number>; setRatios: (r: Record<string, number>) => void;
  stationFuel: Record<string, string>; setStationFuel: (s: Record<string, string>) => void;
}) {
  const serverFields: [keyof Server, string, string][] = [
    ['craftTime', 'Crafting-tijd ×', '1 = normaal, 0.5 = twee keer zo snel'],
    ['harvest', 'Harvest amount ×', '2 = dubbel zoveel per slag (alleen voor de verzameltijd)'],
    ['fuelBurn', 'Fuel burn time ×', '2 = brandstof brandt twee keer zo lang'],
  ];
  const setB = (st: string, b: Bonus) => setBonus({ ...bonus, [st]: { ...bonus[st], ...b } });
  return (
    <>
      <h3>Server (G-Portal)</h3>
      <p className="note">Neem de waarden over uit je serverinstellingen. Namen kunnen daar iets anders heten.</p>
      <ul className="rows">
        {serverFields.map(([k, label, hint]) => (
          <li key={k}>
            <div className="grow">{label}<small>{hint}</small></div>
            <input className="num" type="number" inputMode="decimal" step="0.1" min={0} value={server[k]}
              onChange={(e) => setServer({ ...server, [k]: Number(e.target.value) || 0 })} />
          </li>
        ))}
      </ul>

      <h3>Bonussen per station</h3>
      <p className="note">⚠ Percentages zijn niet geverifieerd; aanpassen in data/bonuses.json.</p>
      <ul className="rows">
        {STATIONS.map((st) => {
          const up = bonusData.upgrades.find((u) => u.station === st);
          return (
            <li key={st} className="wrap">
              <div className="grow">{stationName(st)}</div>
              <select value={bonus[st]?.thrall ?? ''} onChange={(e) => setB(st, { thrall: e.target.value })}>
                <option value="">Geen thrall</option>
                {bonusData.thralls.map((t) => <option key={t.id} value={t.id}>{t.label} (−{t.time}% tijd)</option>)}
              </select>
              {up && (
                <label className="toggle">
                  <input type="checkbox" className="check" checked={!!bonus[st]?.upgrade} onChange={(e) => setB(st, { upgrade: e.target.checked })} />
                  {name(up.to)} gebruiken (−{up.time}% tijd, −{up.fuel}% brandstof{up.material ? `, −${up.material}% materiaal` : ''})
                </label>
              )}
            </li>
          );
        })}
      </ul>
      <button className="wide" onClick={() => { setServer(DEFAULT_SERVER); setBonus({}); }}>Server & bonussen standaard</button>

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
