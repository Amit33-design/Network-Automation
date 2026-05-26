import { useMemo, useState } from 'react';
import { useIntentStore } from '@/store/intentStore';
import { NavButtons } from '@/components/ui/NavButtons';
import { PageTabs } from '@/components/ui/PageTabs';
import { Badge } from '@/components/ui/Badge';
import { generateBom, getLifecycleWarnings } from '@/domain/bom';
import { generateCablingMatrix, exportCablingCSV } from '@/domain/cabling';
import { recommendOptics, exportOpticsCSV } from '@/domain/optics';
import { calcTCO, exportTCOCSV } from '@/domain/tco';
import { buildTopologyGraph } from '@/domain/topology';
import { validateIntent } from '@/domain/constraints';
import { PRODUCTS } from '@/domain/products';
import { TopologyCanvas } from '@/components/topology/TopologyCanvas';
import type {
  VendorType, RedundancyType, UnderlayType, OverlayType,
  BandwidthGbps, FirewallType, AutomationType,
} from '@/types/intent';

// ─── Requirements Form ────────────────────────────────────────────────────────

function RequirementsForm() {
  const { intent, setIntent } = useIntentStore();

  function toggleVendor(v: VendorType) {
    const has = intent.vendors.includes(v);
    setIntent({ vendors: has ? intent.vendors.filter((x) => x !== v) : [...intent.vendors, v] });
  }
  function toggleFeature(f: string) {
    const has = intent.protocols.features.includes(f);
    setIntent({ protocols: { ...intent.protocols, features: has ? intent.protocols.features.filter((x) => x !== f) : [...intent.protocols.features, f] } });
  }
  function toggleOverlay(o: OverlayType) {
    const has = intent.protocols.overlay.includes(o);
    setIntent({ protocols: { ...intent.protocols, overlay: has ? intent.protocols.overlay.filter((x) => x !== o) : [...intent.protocols.overlay, o] } });
  }

  const violations = validateIntent(intent);
  const errors = violations.filter((v) => v.severity === 'error');
  const warnings = violations.filter((v) => v.severity === 'warning');

  const VENDORS: VendorType[] = ['cisco', 'arista', 'juniper', 'nvidia', 'fortinet', 'hpe', 'dell', 'extreme'];
  const FEATURES = ['bfd', 'ecmp', 'vrf', 'anycast_gw', 'ipv6', 'multicast', 'qos', 'flowspec', 'pbr', 'rr', 'bgp_unnumbered'];
  const OVERLAYS: OverlayType[] = ['vxlan_evpn', 'mpls_sr', 'gre', 'ipsec', 'geneve', 'none'];
  const UNDERLAYS: UnderlayType[] = ['bgp', 'ospf', 'is-is', 'eigrp', 'static'];
  const REDUNDANCIES: RedundancyType[] = ['none', 'basic', 'ha', 'full'];
  const BW_OPTIONS: BandwidthGbps[] = [1, 10, 25, 100, 400];
  const AUTOMATIONS: AutomationType[] = ['manual', 'ansible', 'terraform', 'netconf', 'napalm', 'nso'];
  const FIREWALLS: FirewallType[] = ['perimeter', 'distributed', 'microseg', 'none'];

  const inputCls = 'bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500 w-full';
  const chip = (active: boolean) => `px-3 py-1 rounded text-xs font-medium border cursor-pointer transition-colors ${active ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-800 border-slate-600 text-slate-300 hover:border-slate-400'}`;
  const sectionTitle = 'text-sm font-semibold text-white border-b border-slate-700 pb-2 mb-3';

  return (
    <div className="space-y-6">
      {errors.length > 0 && (
        <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 space-y-1">
          <div className="text-red-400 font-medium text-sm mb-2">Constraint Violations</div>
          {errors.map((v) => <div key={v.id} className="text-xs text-red-300">❌ [{v.id}] {v.msg} — {v.fix}</div>)}
        </div>
      )}
      {warnings.length > 0 && (
        <div className="bg-yellow-900/20 border border-yellow-800 rounded-lg p-4 space-y-1">
          {warnings.map((v) => <div key={v.id} className="text-xs text-yellow-300">⚠️ [{v.id}] {v.msg}</div>)}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <h3 className={sectionTitle}>Organisation</h3>
          <div><label className="text-xs font-medium text-slate-400 uppercase tracking-wide block mb-1">Org Name</label>
            <input className={inputCls} value={intent.org.name} onChange={(e) => setIntent({ org: { ...intent.org, name: e.target.value } })} placeholder="Acme Corp" />
          </div>
          <div><label className="text-xs font-medium text-slate-400 uppercase tracking-wide block mb-1">Industry</label>
            <input className={inputCls} value={intent.industry} onChange={(e) => setIntent({ industry: e.target.value })} placeholder="technology" />
          </div>
          <div><label className="text-xs font-medium text-slate-400 uppercase tracking-wide block mb-1">Sites</label>
            <input className={inputCls} type="number" min={1} value={intent.org.sites} onChange={(e) => setIntent({ org: { ...intent.org, sites: +e.target.value } })} />
          </div>
        </div>

        <div className="space-y-4">
          <h3 className={sectionTitle}>Topology Sizing</h3>
          <div><label className="text-xs font-medium text-slate-400 uppercase tracking-wide block mb-1">Endpoint Count</label>
            <input className={inputCls} type="number" min={1} value={intent.topology.endpoint_count} onChange={(e) => setIntent({ topology: { ...intent.topology, endpoint_count: +e.target.value } })} />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wide block mb-1">Bandwidth per Server (Gbps)</label>
            <div className="flex flex-wrap gap-2 mt-1">{BW_OPTIONS.map((b) => <button key={b} onClick={() => setIntent({ topology: { ...intent.topology, bandwidth_gbps: b } })} className={chip(intent.topology.bandwidth_gbps === b)}>{b}G</button>)}</div>
          </div>
          <div><label className="text-xs font-medium text-slate-400 uppercase tracking-wide block mb-1">Oversubscription Ratio</label>
            <input className={inputCls} type="number" min={1} max={10} value={intent.topology.oversubscription} onChange={(e) => setIntent({ topology: { ...intent.topology, oversubscription: +e.target.value } })} />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wide block mb-1">Redundancy</label>
            <div className="flex flex-wrap gap-2 mt-1">{REDUNDANCIES.map((r) => <button key={r} onClick={() => setIntent({ topology: { ...intent.topology, redundancy: r } })} className={chip(intent.topology.redundancy === r)}>{r}</button>)}</div>
          </div>
        </div>
      </div>

      <div>
        <h3 className={sectionTitle}>Preferred Vendors</h3>
        <div className="flex flex-wrap gap-2">{VENDORS.map((v) => <button key={v} onClick={() => toggleVendor(v)} className={chip(intent.vendors.includes(v))}>{v}</button>)}</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <h3 className={sectionTitle}>Protocols</h3>
          <div>
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wide block mb-1">Underlay</label>
            <div className="flex flex-wrap gap-2 mt-1">{UNDERLAYS.map((u) => <button key={u} onClick={() => setIntent({ protocols: { ...intent.protocols, underlay: u } })} className={chip(intent.protocols.underlay === u)}>{u}</button>)}</div>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wide block mb-1">Overlay</label>
            <div className="flex flex-wrap gap-2 mt-1">{OVERLAYS.map((o) => <button key={o} onClick={() => toggleOverlay(o)} className={chip(intent.protocols.overlay.includes(o))}>{o}</button>)}</div>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wide block mb-1">Features</label>
            <div className="flex flex-wrap gap-2 mt-1">{FEATURES.map((f) => <button key={f} onClick={() => toggleFeature(f)} className={chip(intent.protocols.features.includes(f))}>{f}</button>)}</div>
          </div>
        </div>

        <div className="space-y-4">
          <h3 className={sectionTitle}>Security & Automation</h3>
          <div>
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wide block mb-1">Firewall Mode</label>
            <div className="flex flex-wrap gap-2 mt-1">{FIREWALLS.map((f) => <button key={f} onClick={() => setIntent({ security: { ...intent.security, firewall: f } })} className={chip(intent.security.firewall === f)}>{f}</button>)}</div>
          </div>
          <div><label className="text-xs font-medium text-slate-400 uppercase tracking-wide block mb-1">Compliance (comma-separated)</label>
            <input className={inputCls} value={intent.security.compliance.join(', ')} onChange={(e) => setIntent({ security: { ...intent.security, compliance: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) } })} placeholder="pci_dss, hipaa" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wide block mb-1">Automation Tool</label>
            <div className="flex flex-wrap gap-2 mt-1">{AUTOMATIONS.map((a) => <button key={a} onClick={() => setIntent({ applications: { ...intent.applications, automation: a } })} className={chip(intent.applications.automation === a)}>{a}</button>)}</div>
          </div>
        </div>
      </div>

      {intent.use_case === 'gpu_cluster' && (
        <div>
          <h3 className={sectionTitle}>GPU / AI Fabric</h3>
          <div className="flex flex-wrap gap-2">
            {(['pfc', 'ecn_dcqcn', 'rail_optimized', 'nvlink'] as const).map((k) => (
              <button key={k} onClick={() => setIntent({ gpu: { ...intent.gpu, [k]: !intent.gpu[k] } })} className={chip(intent.gpu[k])}>{k}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── BOM Table ────────────────────────────────────────────────────────────────

function BOMTable() {
  const { intent } = useIntentStore();
  const [filter, setFilter] = useState('');
  const [sortCol, setSortCol] = useState<string>('subLayer');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const result = useMemo(() => generateBom(intent, PRODUCTS), [intent]);
  const warnings = useMemo(() => getLifecycleWarnings(result.devices), [result]);

  const filtered = useMemo(() => {
    const q = filter.toLowerCase();
    return result.devices.filter((d) =>
      !q || (d.hostname ?? d.id).toLowerCase().includes(q) || d.subLayer.toLowerCase().includes(q) || d.model.toLowerCase().includes(q)
    );
  }, [result.devices, filter]);

  type SortableKey = 'hostname' | 'subLayer' | 'model' | 'vendor' | 'ports' | 'qty' | 'priceUSD';
  const sorted = useMemo(() => {
    const key = sortCol as SortableKey;
    return [...filtered].sort((a, b) => {
      const av = String(a[key] ?? '');
      const bv = String(b[key] ?? '');
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }, [filtered, sortCol, sortDir]);

  function sort(col: string) {
    if (sortCol === col) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  }

  const th = (col: string, label: string) => (
    <th onClick={() => sort(col)} className="text-left text-xs font-medium text-slate-400 uppercase tracking-wide px-3 py-2 cursor-pointer hover:text-white select-none whitespace-nowrap">
      {label} {sortCol === col ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
    </th>
  );

  return (
    <div className="space-y-4">
      {warnings.length > 0 && (
        <div className="bg-yellow-900/20 border border-yellow-800 rounded-lg px-4 py-3 space-y-1">
          {warnings.map((w, i) => (
            <div key={i} className="text-xs text-yellow-300">
              ⚠️ {w.hostname} ({w.model}) — {w.status.toUpperCase()}
              {w.successor ? ` · successor: ${w.successor}` : ''}
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-4 text-sm">
          {result.sizing && <>
            <span className="text-slate-400">Leafs: <span className="text-blue-400 font-mono">{result.sizing.leaf_count}</span></span>
            <span className="text-slate-400">Spines: <span className="text-blue-400 font-mono">{result.sizing.spine_count}</span></span>
          </>}
          <span className="text-slate-400">Total: <span className="text-blue-400 font-mono">{result.devices.length}</span></span>
          {result.sizing?.warning && <Badge variant="yellow">{result.sizing.warning}</Badge>}
        </div>
        <input
          className="ml-auto bg-slate-800 border border-slate-600 rounded px-3 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 w-48"
          placeholder="Filter devices…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-800/80 border-b border-slate-700">
            <tr>
              {th('hostname', 'Hostname')}
              {th('subLayer', 'Role')}
              {th('model', 'Model')}
              {th('vendor', 'Vendor')}
              {th('ports', 'Ports')}
              {th('qty', 'Qty')}
              <th className="text-left text-xs font-medium text-slate-400 uppercase tracking-wide px-3 py-2">Lifecycle</th>
              {th('priceUSD', 'Unit Price')}
            </tr>
          </thead>
          <tbody>
            {sorted.map((d, i) => {
              const lcStatus = result.lifecycleWarnings.find((w) => w.hostname === (d.hostname ?? d.id))?.status;
              return (
                <tr key={i} className="border-b border-slate-800 hover:bg-slate-800/50 transition-colors">
                  <td className="px-3 py-2 font-mono text-blue-300 text-xs">{d.hostname ?? d.id}</td>
                  <td className="px-3 py-2 text-slate-300">{d.subLayer}</td>
                  <td className="px-3 py-2 text-white font-medium">{d.model}</td>
                  <td className="px-3 py-2 text-slate-400">{d.vendor}</td>
                  <td className="px-3 py-2 text-slate-400 font-mono">{d.ports}</td>
                  <td className="px-3 py-2 text-slate-300 font-mono">{d.qty ?? 1}</td>
                  <td className="px-3 py-2">
                    {lcStatus === 'eol' ? <Badge variant="red">EoL</Badge>
                      : lcStatus === 'eos' ? <Badge variant="yellow">EoS</Badge>
                      : lcStatus === 'eol-soon' ? <Badge variant="yellow">EoL Soon</Badge>
                      : <Badge variant="green">Active</Badge>}
                  </td>
                  <td className="px-3 py-2 text-slate-300 font-mono">${(d.priceUSD ?? 0).toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── TCO Panel ────────────────────────────────────────────────────────────────

function TCOPanel() {
  const { intent } = useIntentStore();
  const bomResult = useMemo(() => generateBom(intent, PRODUCTS), [intent]);
  const cabling = useMemo(() => generateCablingMatrix(bomResult.devices), [bomResult.devices]);
  const optics = useMemo(() => recommendOptics(cabling, bomResult.devices), [cabling, bomResult.devices]);
  const tco = useMemo(() => calcTCO(bomResult.devices, cabling, optics), [bomResult.devices, cabling, optics]);

  function download() {
    const blob = new Blob([exportTCOCSV(tco)], { type: 'text/csv' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'tco.csv' });
    a.click();
  }

  const r = (label: string, val: number, highlight = false) => (
    <div className={`flex justify-between py-2 border-b border-slate-800 ${highlight ? 'text-blue-300 font-semibold' : 'text-slate-300'}`}>
      <span className="text-sm">{label}</span>
      <span className="font-mono text-sm">${val.toLocaleString()}</span>
    </div>
  );

  const t = tco.totals;
  return (
    <div className="max-w-xl space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-semibold text-white">3-Year TCO Summary</h3>
        <button onClick={download} className="text-xs border border-slate-600 hover:border-slate-400 text-slate-400 hover:text-white px-3 py-1 rounded transition-colors">Export CSV</button>
      </div>
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
        {r('Hardware CapEx', t.hwCapex)}
        {r('Optics', t.opticsCapex)}
        {r('Cabling', t.cablingCapex)}
        {r('Annual OpEx (power + SW license + support)', t.totalOpexYr)}
        {r('3-Year OpEx', t.totalOpexYr * 3)}
        {r('3-Year Total (TCO)', t.tco3yr, true)}
      </div>
    </div>
  );
}

// ─── Cabling Panel ────────────────────────────────────────────────────────────

function CablingPanel() {
  const { intent } = useIntentStore();
  const bomResult = useMemo(() => generateBom(intent, PRODUCTS), [intent]);
  const cabling = useMemo(() => generateCablingMatrix(bomResult.devices), [bomResult.devices]);
  const optics = useMemo(() => recommendOptics(cabling, bomResult.devices), [cabling, bomResult.devices]);

  function downloadCabling() {
    const blob = new Blob([exportCablingCSV(cabling)], { type: 'text/csv' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'cabling.csv' });
    a.click();
  }
  function downloadOptics() {
    const blob = new Blob([exportOpticsCSV(optics)], { type: 'text/csv' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'optics.csv' });
    a.click();
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-sm font-semibold text-white">Cable Schedule ({cabling.length} cables)</h3>
          <button onClick={downloadCabling} className="text-xs border border-slate-600 hover:border-slate-400 text-slate-400 hover:text-white px-3 py-1 rounded transition-colors">Export CSV</button>
        </div>
        <div className="overflow-x-auto rounded-lg border border-slate-700 max-h-64">
          <table className="w-full text-xs">
            <thead className="bg-slate-800/80 border-b border-slate-700 sticky top-0">
              <tr>{['From', 'To', 'Type', 'Length', 'Part #', 'Qty', 'Unit $'].map((h) => (
                <th key={h} className="text-left font-medium text-slate-400 uppercase tracking-wide px-3 py-2">{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {cabling.map((c, i) => (
                <tr key={i} className="border-b border-slate-800 hover:bg-slate-800/50">
                  <td className="px-3 py-1.5 font-mono text-blue-300">{c.deviceA}</td>
                  <td className="px-3 py-1.5 font-mono text-blue-300">{c.deviceB}</td>
                  <td className="px-3 py-1.5 text-slate-300">{c.cableType}</td>
                  <td className="px-3 py-1.5 text-slate-400">{c.lengthM}m</td>
                  <td className="px-3 py-1.5 font-mono text-slate-400">{c.partNumber}</td>
                  <td className="px-3 py-1.5 font-mono text-slate-300">{c.qty}</td>
                  <td className="px-3 py-1.5 text-slate-300">${c.unitCostUSD}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-sm font-semibold text-white">Optics Recommendations ({optics.length} items)</h3>
          <button onClick={downloadOptics} className="text-xs border border-slate-600 hover:border-slate-400 text-slate-400 hover:text-white px-3 py-1 rounded transition-colors">Export CSV</button>
        </div>
        <div className="overflow-x-auto rounded-lg border border-slate-700 max-h-64">
          <table className="w-full text-xs">
            <thead className="bg-slate-800/80 border-b border-slate-700 sticky top-0">
              <tr>{['SKU', 'Model', 'Speed', 'Reach', 'Fiber', 'Qty', 'Unit $'].map((h) => (
                <th key={h} className="text-left font-medium text-slate-400 uppercase tracking-wide px-3 py-2">{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {optics.map((o, i) => (
                <tr key={i} className="border-b border-slate-800 hover:bg-slate-800/50">
                  <td className="px-3 py-1.5 font-mono text-green-300">{o.opticId}</td>
                  <td className="px-3 py-1.5 text-slate-300">{o.opticModel}</td>
                  <td className="px-3 py-1.5 text-slate-400">{o.speed}</td>
                  <td className="px-3 py-1.5 text-slate-400">{o.reach_m}m</td>
                  <td className="px-3 py-1.5 text-slate-400">{o.fiberType}</td>
                  <td className="px-3 py-1.5 font-mono text-slate-300">{o.qty}</td>
                  <td className="px-3 py-1.5 text-slate-300">${o.unitCostUSD}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Capacity Math Panel ──────────────────────────────────────────────────────

function CapacityMathPanel() {
  const { intent } = useIntentStore();
  const result = useMemo(() => generateBom(intent, PRODUCTS), [intent]);
  const s = result.sizing;

  const row = (label: string, val: string | number, note?: string) => (
    <div className="flex justify-between items-start py-2 border-b border-slate-800">
      <div>
        <span className="text-sm text-slate-300">{label}</span>
        {note && <div className="text-xs text-slate-500">{note}</div>}
      </div>
      <span className="font-mono text-sm text-blue-300 ml-4">{val}</span>
    </div>
  );

  return (
    <div className="max-w-lg bg-slate-800/50 border border-slate-700 rounded-lg p-5">
      <h3 className="text-sm font-semibold text-white mb-3">Port-Math Capacity Trace (CLAUDE.md §6)</h3>
      {s ? (
        <div>
          {row('Endpoints', intent.topology.endpoint_count)}
          {row('Bandwidth per server', `${intent.topology.bandwidth_gbps} Gbps`)}
          {row('Oversubscription', `${intent.topology.oversubscription}:1`)}
          {row('Servers per leaf (downlinks)', s.trace.servers_per_leaf)}
          {row('Raw leaf count (ceil)', s.trace.raw_leaf_count, 'rounded up to even for HA pairs')}
          {row('Leaf count (HA pairs)', s.leaf_count)}
          {row('Server capacity per leaf', `${s.trace.server_capacity_gbps} Gbps`)}
          {row('Required uplink capacity', `${s.trace.required_uplink_gbps} Gbps`, 'capacity / oversubscription')}
          {row('Uplinks per leaf', s.uplinks_per_leaf)}
          {row('Total leaf uplinks', s.trace.total_leaf_uplinks)}
          {row('Spine count (min 2)', s.spine_count)}
          {row('Uplink capacity OK?', s.uplink_capacity_ok ? '✅ Yes' : '❌ No')}
          {s.warning && (
            <div className="mt-3 bg-yellow-900/20 border border-yellow-800 rounded p-3 text-xs text-yellow-300">⚠️ {s.warning}</div>
          )}
        </div>
      ) : (
        <div className="text-slate-500 text-sm py-4 text-center">
          Capacity math requires leaf + spine devices in the BOM.<br/>
          Select a Data Center or similar use case.
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'requirements', label: 'Requirements',     icon: '📋' },
  { id: 'bom',          label: 'Hardware BOM',     icon: '🗄️' },
  { id: 'topology',     label: 'Topology',         icon: '🔗' },
  { id: 'cabling',      label: 'Cabling & Optics', icon: '🔌' },
  { id: 'tco',          label: 'TCO',              icon: '💰' },
  { id: 'math',         label: 'Capacity Math',    icon: '🔢' },
];

export function Step2BOMPage() {
  const { intent } = useIntentStore();
  const bomResult = useMemo(() => generateBom(intent, PRODUCTS), [intent]);
  const topoGraph = useMemo(() => buildTopologyGraph(intent, bomResult.devices), [intent, bomResult.devices]);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white mb-1">Step 2 — Hardware BOM & Topology</h1>
        <p className="text-slate-400 text-sm">
          Use case: <span className="text-blue-400 font-mono">{intent.use_case}</span> ·
          Vendors: <span className="text-blue-400 font-mono">{intent.vendors.join(', ')}</span>
        </p>
      </div>

      <PageTabs tabs={TABS}>
        {(active) => {
          if (active === 'requirements') return <RequirementsForm />;
          if (active === 'bom')          return <BOMTable />;
          if (active === 'topology')     return <TopologyCanvas graph={topoGraph} />;
          if (active === 'cabling')      return <CablingPanel />;
          if (active === 'tco')          return <TCOPanel />;
          if (active === 'math')         return <CapacityMathPanel />;
          return null;
        }}
      </PageTabs>

      <NavButtons prev="/" next="/config" />
    </div>
  );
}
