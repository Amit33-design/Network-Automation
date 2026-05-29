import { useAppStore } from '@/store/useAppStore'

interface Props {
  onStart: () => void
}

const FEATURES = [
  {
    icon: '🧩',
    title: 'Intent Model',
    desc: 'Describe your network in plain terms — use case, scale, compliance, and vendor preferences.',
  },
  {
    icon: '🏆',
    title: 'AI Product Scoring',
    desc: 'Automatically selects the best-fit SKUs from 40+ hardware products scored against your intent.',
  },
  {
    icon: '📐',
    title: 'Auto Topology + Config',
    desc: 'Generates HLD topology diagrams and production-ready device configs for 5 OS platforms.',
  },
  {
    icon: '🛡️',
    title: 'Safe Deployment Pipeline',
    desc: 'Pre/post checks, platform-native rollback, and canary-first deployment flow.',
  },
  {
    icon: '🧪',
    title: 'Network Simulation',
    desc: 'ZTP state-machine demo with fault injection to validate provisioning logic before go-live.',
  },
  {
    icon: '📤',
    title: 'Export & Report',
    desc: 'Export BOM, cabling schedule, optics, and device configs as CSV and text files.',
  },
]

const USE_CASES = [
  { icon: '🏢', label: 'Campus/Enterprise' },
  { icon: '🗄️', label: 'Data Center Leaf-Spine' },
  { icon: '⚡', label: 'AI/GPU Cluster' },
  { icon: '🌍', label: 'WAN/SD-WAN' },
  { icon: '🔗', label: 'Hybrid' },
  { icon: '🗺️', label: 'Multi-Site DCI' },
]

const STATS = [
  { value: '40+', label: 'Hardware SKUs' },
  { value: '5',   label: 'OS Platforms' },
  { value: '6',   label: 'Use Cases' },
  { value: '100%',label: 'Browser-Native' },
]

export function LandingPage({ onStart }: Props) {
  const { setUseCase, setScale } = useAppStore()

  function handleDemo() {
    setUseCase('dc')
    setScale('medium')
    onStart()
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-200 flex flex-col">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="border-b border-white/10 bg-gray-900/80 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-6 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/favicon.svg" alt="NetDesign AI" className="w-8 h-8" />
            <div className="flex flex-col leading-tight">
              <span className="font-extrabold text-white text-[15px] tracking-wide">
                NetDesign <span className="text-blue-400">AI</span>
              </span>
              <span className="text-[9px] text-gray-500 tracking-widest uppercase">
                Intent‑Driven Network Automation
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onStart}
              className="px-4 py-1.5 rounded-lg text-sm font-semibold
                         bg-blue-600 text-white hover:bg-blue-500 transition-colors cursor-pointer"
            >
              Launch App →
            </button>
          </div>
        </div>
      </header>

      {/* ── Hero ───────────────────────────────────────────────────────────── */}
      <section className="max-w-3xl mx-auto px-6 py-12 sm:py-16">
        <div className="flex flex-col items-center text-center gap-7">

          {/* Brand logo image — on top */}
          <img
            src="/logo-brand.jpg"
            alt="NetDesign AI — Intent-Driven Network Automation"
            className="w-full max-w-[340px] rounded-2xl shadow-2xl shadow-blue-900/40 ring-1 ring-white/10"
          />

          {/* Text — below logo */}
          <div className="flex flex-col items-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs
                            bg-blue-600/15 border border-blue-500/30 text-blue-400 mb-5">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
              Browser-native · No backend required · Open source
            </div>

            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-white mb-4 leading-tight">
              From network intent to{' '}
              <span className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
                production-ready design
              </span>{' '}
              in minutes
            </h1>

            <p className="text-base text-gray-400 mb-6 max-w-xl">
              Describe your network — use case, scale, vendor, compliance — and get a complete
              BOM, HLD topology, and device configs for NX-OS, IOS-XE, EOS, JunOS, and PAN-OS.
            </p>

            {/* Feature pills matching logo */}
            <div className="flex flex-wrap gap-2 justify-center mb-8">
              {[
                { icon: '🧩', label: 'Design' },
                { icon: '⚙️', label: 'Automate' },
                { icon: '🛡', label: 'Validate' },
                { icon: '📊', label: 'Assure' },
              ].map(p => (
                <span key={p.label}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold
                             bg-blue-600/10 border border-blue-500/25 text-blue-300">
                  {p.icon} {p.label}
                </span>
              ))}
            </div>

            <div className="flex flex-wrap gap-3 justify-center">
              <button
                type="button"
                onClick={onStart}
                className="px-7 py-3 rounded-xl text-base font-bold
                           bg-blue-600 text-white hover:bg-blue-500 transition-colors cursor-pointer
                           shadow-lg shadow-blue-600/25"
              >
                Start Designing →
              </button>
              <button
                type="button"
                onClick={handleDemo}
                className="px-7 py-3 rounded-xl text-base font-bold border
                           bg-white/5 border-white/15 text-gray-200
                           hover:bg-blue-500/15 hover:border-blue-500/40 hover:text-blue-300
                           transition-colors cursor-pointer"
              >
                Try Demo
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Stats bar ──────────────────────────────────────────────────────── */}
      <section className="border-y border-white/8 bg-white/[0.02]">
        <div className="max-w-6xl mx-auto px-6 py-6 grid grid-cols-2 sm:grid-cols-4 gap-6 text-center">
          {STATS.map(s => (
            <div key={s.label}>
              <div className="text-2xl font-extrabold text-white">{s.value}</div>
              <div className="text-xs text-gray-500 mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Feature cards ──────────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 py-16">
        <h2 className="text-2xl font-bold text-white text-center mb-10">
          Everything you need, nothing you don't
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map(f => (
            <div
              key={f.title}
              className="rounded-2xl border border-white/10 bg-white/[0.03] p-6
                         hover:border-blue-500/30 hover:bg-blue-500/5 transition-colors"
            >
              <div className="text-3xl mb-3">{f.icon}</div>
              <h3 className="font-semibold text-white mb-1.5">{f.title}</h3>
              <p className="text-sm text-gray-400 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Use case chips ─────────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 pb-16 text-center">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-widest mb-5">
          Supported use cases
        </h2>
        <div className="flex flex-wrap gap-3 justify-center">
          {USE_CASES.map(uc => (
            <span
              key={uc.label}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm
                         bg-white/5 border border-white/10 text-gray-300"
            >
              {uc.icon} {uc.label}
            </span>
          ))}
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer className="mt-auto border-t border-white/8 bg-gray-900/60">
        <div className="max-w-6xl mx-auto px-6 py-5 flex flex-wrap items-center justify-between gap-3 text-xs text-gray-500">
          <span>NDAL v1.0 · Source-Available</span>
          <div className="flex items-center gap-4">
            <a
              href="https://github.com/Amit33-design/Network-Automation"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-gray-300 transition-colors"
            >
              GitHub
            </a>
            <span>Built by Amit Tiwari</span>
          </div>
        </div>
      </footer>

    </div>
  )
}
