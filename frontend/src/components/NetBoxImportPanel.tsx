import { useState } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { useAppStore } from '@/store/useAppStore'
import {
  fetchNetBoxInventory, summarizeInventory, inventoryToStorePatch, SAMPLE_INVENTORY,
  type NetBoxInventory, type NetBoxImportPreview,
} from '@/lib/netbox'

// Only the URL is persisted — the API token is intentionally kept in memory
// so it never lands in localStorage.
const URL_STORAGE_KEY = 'netdesign_netbox_url'

const UC_LABELS: Record<string, string> = {
  campus: 'Campus/LAN', dc: 'Data Center', gpu: 'AI/GPU', wan: 'WAN/SD-WAN',
  multisite: 'Multi-Site', multicloud: 'Multi-Cloud', aviatrix: 'Aviatrix',
}

export function NetBoxImportPanel() {
  const { showToast } = useToast()
  const { setOrgName, setNumSites, setOrgSize, setVendorPrefs, setNetboxDevices } = useAppStore()

  const [url, setUrl] = useState(() => {
    try { return localStorage.getItem(URL_STORAGE_KEY) ?? '' } catch { return '' }
  })
  const [token, setToken] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [showCorsNote, setShowCorsNote] = useState(false)
  const [inventory, setInventory] = useState<NetBoxInventory | null>(null)
  const [preview, setPreview] = useState<NetBoxImportPreview | null>(null)

  function loadPreview(inv: NetBoxInventory) {
    setInventory(inv)
    setPreview(summarizeInventory(inv))
  }

  async function connect() {
    if (!url) { showToast('Enter a NetBox URL', 'error'); return }
    try { localStorage.setItem(URL_STORAGE_KEY, url) } catch { /* private mode */ }
    setConnecting(true)
    setShowCorsNote(false)
    try {
      const inv = await fetchNetBoxInventory(url, token)
      loadPreview(inv)
      showToast(`NetBox connected — ${inv.devices.length} devices found`, 'success')
    } catch (err) {
      setShowCorsNote(true)
      showToast(`NetBox error: ${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      setConnecting(false)
    }
  }

  function apply() {
    if (!inventory) return
    const patch = inventoryToStorePatch(inventory)
    if (patch.orgName !== undefined) setOrgName(patch.orgName)
    if (patch.numSites !== undefined) setNumSites(patch.numSites)
    if (patch.orgSize !== undefined) setOrgSize(patch.orgSize)
    if (patch.vendorPrefs !== undefined) setVendorPrefs(patch.vendorPrefs)
    setNetboxDevices(patch.netboxDevices)
    showToast(`NetBox data applied — ${patch.netboxDevices.length} devices imported`, 'success')
    clear()
  }

  function clear() {
    setInventory(null)
    setPreview(null)
  }

  const inputClass =
    'w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-gray-200 ' +
    'placeholder-gray-600 focus:outline-none focus:border-blue-500'

  return (
    <Card>
      <h3 className="text-sm font-semibold text-gray-300 mb-1">
        🔗 Import from NetBox / Nautobot <span className="text-gray-500 font-normal">(optional)</span>
      </h3>
      <p className="text-xs text-gray-500 mb-3">
        Connect to your NetBox or Nautobot instance to pre-fill organisation name, sites,
        org size, and vendor preferences — and feed the imported device list to Step 6 ZTP.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[2fr_2fr_auto_auto] gap-3 items-end">
        <div>
          <label className="text-xs text-gray-400 block mb-1">NetBox URL</label>
          <input
            type="url"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://netbox.corp.com"
            className={inputClass}
          />
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">API Token</label>
          <input
            type="password"
            value={token}
            onChange={e => setToken(e.target.value)}
            placeholder="abc123…"
            autoComplete="off"
            className={inputClass}
          />
        </div>
        <Button onClick={connect} disabled={connecting}>
          {connecting ? 'Connecting…' : 'Connect & Preview'}
        </Button>
        <Button variant="secondary" onClick={() => loadPreview(SAMPLE_INVENTORY)}>
          Try sample data
        </Button>
      </div>

      {showCorsNote && (
        <div className="mt-3 text-xs text-yellow-300/90 bg-yellow-600/10 border border-yellow-500/30 rounded px-3 py-2">
          <strong>CORS note:</strong> your NetBox must allow requests from this origin. Add{' '}
          <code className="text-yellow-200">{window.location.origin}</code> under NetBox →
          Administration → CORS Origins, then retry.
        </div>
      )}

      {preview && (
        <div className="mt-4">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="text-gray-500 border-b border-white/10">
                <th className="py-1.5 pr-4 font-medium">Field</th>
                <th className="py-1.5 pr-4 font-medium">NetBox data</th>
                <th className="py-1.5 font-medium">Will set</th>
              </tr>
            </thead>
            <tbody className="text-gray-300">
              <tr className="border-b border-white/5">
                <td className="py-1.5 pr-4">Organisation name</td>
                <td className="py-1.5 pr-4">{preview.orgName || '—'}</td>
                <td className="py-1.5 text-gray-500">Org Name field</td>
              </tr>
              <tr className="border-b border-white/5">
                <td className="py-1.5 pr-4">Number of sites</td>
                <td className="py-1.5 pr-4">{preview.siteCount}</td>
                <td className="py-1.5 text-gray-500">Number of Sites (Step 2)</td>
              </tr>
              <tr className="border-b border-white/5">
                <td className="py-1.5 pr-4">Org size</td>
                <td className="py-1.5 pr-4">{preview.deviceCount} devices</td>
                <td className="py-1.5 text-gray-500">{preview.orgSize || '—'}</td>
              </tr>
              <tr className="border-b border-white/5">
                <td className="py-1.5 pr-4">Vendors detected</td>
                <td className="py-1.5 pr-4">{preview.vendors.join(', ') || '—'}</td>
                <td className="py-1.5 text-gray-500">Vendor preference chips</td>
              </tr>
              <tr>
                <td className="py-1.5 pr-4">Use case hint</td>
                <td className="py-1.5 pr-4">
                  {preview.useCaseHint
                    ? `${UC_LABELS[preview.useCaseHint] ?? preview.useCaseHint} (${preview.useCaseVotes} matching devices)`
                    : '—'}
                </td>
                <td className="py-1.5 text-gray-500">advisory only</td>
              </tr>
            </tbody>
          </table>
          <div className="flex gap-2 mt-3">
            <Button onClick={apply}>Apply to Form</Button>
            <Button variant="secondary" onClick={clear}>Clear</Button>
          </div>
        </div>
      )}
    </Card>
  )
}
