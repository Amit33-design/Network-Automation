/**
 * Icon set — hand-drawn SVG, no dependency.
 *
 * The UI used emoji for every nav item, use-case card and tab (🎯 📋 🛒 🚀 …).
 * Emoji render differently on every OS, cannot inherit colour or weight, and
 * read as a toy next to the rest of the product. §21 rule 9 forbids new UI
 * packages, so these are drawn here.
 *
 * House style, so a new icon looks like the others:
 *   · 24×24 viewBox, geometry on a 2px grid
 *   · stroke-based, `currentColor`, 1.5 width, round cap and join
 *   · no fills except where a solid mass reads better (status dots)
 *   · optical weight even — a glyph should not be darker than its neighbours
 */
import type { SVGProps } from 'react'

export interface IconProps extends SVGProps<SVGSVGElement> {
  /** Pixel size for both axes. Defaults to 1em so it tracks font-size. */
  size?: number | string
}

function Svg({ size = '1em', children, ...rest }: IconProps) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.5}
      strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false"
      {...rest}
    >
      {children}
    </svg>
  )
}

// ── Network devices ─────────────────────────────────────────────────────────
// Drawn to be told apart at 16px: a router pushes traffic outward, a switch
// fans ports downward, a spine sits above and a leaf below.

/** Router — chassis with traffic leaving in four directions. */
export const IconRouter = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.5" y="9" width="19" height="9" rx="2" />
    <path d="M6 13.5h.01M9.5 13.5h.01M13 13.5h.01" />
    <path d="M16 6.5 19 3.5M19 3.5h-3M19 3.5v3" />
    <path d="M19.5 6.5 16.5 3.5M16.5 3.5h3M16.5 3.5v3" opacity=".45" />
    <path d="M18 18v2.5M6 18v2.5" opacity=".45" />
  </Svg>
)

/** Switch — chassis over a row of access ports. */
export const IconSwitch = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.5" y="6" width="19" height="8" rx="2" />
    <path d="M6 10h.01M9 10h.01M12 10h.01" />
    <path d="M17.5 10h2" opacity=".6" />
    <path d="M6 14v3.5M10 14v3.5M14 14v3.5M18 14v3.5" />
    <path d="M4.5 17.5h15" opacity=".45" />
  </Svg>
)

/** Spine — aggregation switch, links fanning down to the leaves. */
export const IconSpine = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="3" width="17" height="6" rx="1.75" />
    <path d="M7 6h1.5M11.25 6h1.5" opacity=".8" />
    <path d="M7.5 9.5 4.5 15.5M12 9.5v6M16.5 9.5l3 6" />
    <path d="M2.5 18.5h4M10 18.5h4M17.5 18.5h4" />
  </Svg>
)

/** Leaf — top-of-rack switch with uplinks rising to the spine. */
export const IconLeaf = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7.5 8.5 5 3M12 8.5v-6M16.5 8.5 19 3" />
    <rect x="3.5" y="9" width="17" height="6" rx="1.75" />
    <path d="M7 12h1.5M11.25 12h1.5" opacity=".8" />
    <path d="M6.5 15.5v4M12 15.5v4M17.5 15.5v4" />
  </Svg>
)

/** Firewall — brick coursing behind a shield. */
export const IconFirewall = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 6h18M3 10.5h18M3 15h18" />
    <path d="M8 6v4.5M16 6v4.5M5.5 10.5V15M12 10.5V15M18.5 10.5V15" opacity=".55" />
    <path d="M12 8.5 16.5 10v3.6c0 2.4-1.9 4.3-4.5 5.4-2.6-1.1-4.5-3-4.5-5.4V10Z"
          fill="currentColor" fillOpacity=".14" />
  </Svg>
)

/** Server / compute — stacked rack units. */
export const IconServer = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="6" rx="1.75" />
    <rect x="3" y="14" width="18" height="6" rx="1.75" />
    <path d="M6.5 7h.01M6.5 17h.01" />
    <path d="M15 7h3M15 17h3" opacity=".55" />
  </Svg>
)

/** Cloud gateway. */
export const IconCloud = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 18.5a4 4 0 0 1-.6-7.96 5.2 5.2 0 0 1 10 -1.2A3.9 3.9 0 0 1 17.5 18.5Z" />
  </Svg>
)

/** Radio unit / antenna — O-RAN and wireless. */
export const IconRadio = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 12.5v8M9 20.5h6" />
    <circle cx="12" cy="10" r="1.75" />
    <path d="M8.4 6.4a5 5 0 0 0 0 7.2M15.6 6.4a5 5 0 0 1 0 7.2" />
    <path d="M5.9 3.9a8.5 8.5 0 0 0 0 12.2M18.1 3.9a8.5 8.5 0 0 1 0 12.2" opacity=".5" />
  </Svg>
)

/** WAN edge — globe with a routed path across it. */
export const IconGlobe = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3.2 9.5h17.6M3.2 14.5h17.6" opacity=".6" />
    <path d="M12 3a15 15 0 0 1 0 18A15 15 0 0 1 12 3Z" />
  </Svg>
)

/** Multi-site — two sites joined by a link. */
export const IconSites = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.5" y="6" width="7" height="12" rx="1.5" />
    <rect x="14.5" y="6" width="7" height="12" rx="1.5" />
    <path d="M9.5 12h5" />
    <path d="M5 9.5h2M5 13h2M17 9.5h2M17 13h2" opacity=".55" />
  </Svg>
)

/** Campus building. */
export const IconBuilding = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 21V5.5A1.5 1.5 0 0 1 5.5 4h7A1.5 1.5 0 0 1 14 5.5V21" />
    <path d="M14 10h4.5A1.5 1.5 0 0 1 20 11.5V21" />
    <path d="M2.5 21h19" />
    <path d="M7 8h.01M11 8h.01M7 12h.01M11 12h.01M7 16h.01M11 16h.01M17 14h.01M17 17.5h.01" />
  </Svg>
)

/** GPU / accelerator — die with pins. */
export const IconGpu = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5" y="5" width="14" height="14" rx="2.25" />
    <rect x="9.25" y="9.25" width="5.5" height="5.5" rx="1"
          fill="currentColor" fillOpacity=".16" />
    <path d="M9.5 2.75V5M14.5 2.75V5M9.5 19v2.25M14.5 19v2.25" />
    <path d="M2.75 9.5H5M2.75 14.5H5M19 9.5h2.25M19 14.5h2.25" />
  </Svg>
)

// ── Wizard / navigation ─────────────────────────────────────────────────────

export const IconTarget = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" />
    <circle cx="12" cy="12" r="1" fill="currentColor" />
  </Svg>
)

export const IconClipboard = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 4.5H7A1.5 1.5 0 0 0 5.5 6v13A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V6A1.5 1.5 0 0 0 17 4.5h-2" />
    <rect x="9" y="2.5" width="6" height="4" rx="1.25" />
    <path d="M8.75 11h6.5M8.75 15h4.5" opacity=".7" />
  </Svg>
)

export const IconCatalog = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 9h18" />
    <path d="M6.5 13h5M6.5 16.5h8" opacity=".7" />
    <path d="M16.5 12.5h1.5v4h-1.5z" opacity=".55" />
  </Svg>
)

export const IconBlueprint = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.5" y="4.5" width="19" height="15" rx="2" />
    <path d="M2.5 9h19" opacity=".5" />
    <circle cx="8" cy="14" r="2" /><circle cx="16.5" cy="12" r="1.5" />
    <path d="M10 14h4.9M8 12V11" />
  </Svg>
)

export const IconCog = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="7.25" />
    <circle cx="12" cy="12" r="2.75" />
    <path d="M12 2.75v2M12 19.25v2M21.25 12h-2M4.75 12h-2M18.55 5.45l-1.4 1.4M6.85 17.15l-1.4 1.4M18.55 18.55l-1.4-1.4M6.85 6.85l-1.4-1.4" />
  </Svg>
)

export const IconDeploy = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 2.5c2.6 2.2 4 5.2 4 8.7v4.3H8v-4.3c0-3.5 1.4-6.5 4-8.7Z" />
    <circle cx="12" cy="9.5" r="1.75" />
    <path d="M8 12.5 5.5 15v3l2.5-1.6M16 12.5 18.5 15v3L16 16.4" />
    <path d="M10.5 18.5 12 21.5l1.5-3" fill="currentColor" fillOpacity=".18" />
  </Svg>
)

export const IconSatellite = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 19.5 10 14" />
    <path d="M3 21c1.6-1.1 2.6-2.4 3-3.9L8.9 20c-1.5.4-2.8 1.4-3.9 3Z" fill="currentColor" fillOpacity=".14" />
    <path d="M12.5 11.5 9 8l3.5-3.5L16 8Z" />
    <path d="M14.5 15.5A7 7 0 0 0 8.5 9.5" opacity=".55" />
    <path d="M18.5 18.5A11 11 0 0 0 5.5 5.5" opacity=".4" />
  </Svg>
)

export const IconCheckShield = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 2.75 19.5 5.5v6c0 4.2-3.1 7.6-7.5 9.75C7.6 19.1 4.5 15.7 4.5 11.5v-6Z" />
    <path d="m8.75 11.75 2.4 2.4 4.1-4.6" />
  </Svg>
)

export const IconTerminal = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.5" y="4" width="19" height="16" rx="2" />
    <path d="m6.5 9.5 3 2.5-3 2.5M12.5 15h5" />
  </Svg>
)

export const IconChart = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 3.5v17h17" />
    <path d="M7.5 15.5v2M11.5 11v6.5M15.5 13v4.5M19.5 7.5v10" />
    <path d="m7 10.5 4.5-4 3.5 3 4.5-5" opacity=".55" />
  </Svg>
)

export const IconWrench = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15.2 3.4a5.5 5.5 0 0 0-6.6 7L3.4 15.6a2 2 0 0 0 2.8 2.8l5.2-5.2a5.5 5.5 0 0 0 7-6.6l-3 3-2.6-2.6Z" />
    <path d="M6 17h.01" />
  </Svg>
)

export const IconStethoscope = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 3v5a4 4 0 0 0 8 0V3" />
    <path d="M6 3H4.5M14 3h1.5" />
    <path d="M10 12v2.5a5 5 0 0 0 5 5 4 4 0 0 0 4-4v-1.2" />
    <circle cx="19" cy="13" r="2" />
  </Svg>
)

export const IconBug = (p: IconProps) => (
  <Svg {...p}>
    <rect x="7" y="7" width="10" height="12.5" rx="5"
          fill="currentColor" fillOpacity=".12" />
    <path d="M9 7a3 3 0 0 1 6 0" />
    <path d="M12 10.5v6" opacity=".7" />
    <path d="M7 11H3.5M7 15.5H3.5M17 11h3.5M17 15.5h3.5" />
    <path d="M9 4 10.75 6M15 4 13.25 6" />
  </Svg>
)

export const IconSearch = (p: IconProps) => (
  <Svg {...p}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></Svg>
)

export const IconSave = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 4.5h11L19.5 8.5v11a1 1 0 0 1-1 1h-14a1 1 0 0 1-1-1v-14a1 1 0 0 1 1-1Z" />
    <path d="M8 4.5v5h7v-5M8 20.5v-6h8v6" opacity=".7" />
  </Svg>
)

export const IconScroll = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4.5" y="3.5" width="15" height="17" rx="2" />
    <path d="M8 8h8M8 12h8M8 16h5" opacity=".75" />
  </Svg>
)

export const IconExport = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 15.5V3.5M12 3.5 8 7.5M12 3.5l4 4" />
    <path d="M4 14v5a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 19v-5" />
  </Svg>
)

export const IconLink = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 13.5a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.7 1.7" />
    <path d="M14 10.5a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.7-1.7" />
  </Svg>
)

export const IconApproval = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
    <path d="m8 12.5 2.6 2.6L16.5 9" />
  </Svg>
)

export const IconPlug = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 2.5v5M15 2.5v5" />
    <path d="M6.5 7.5h11v3a5.5 5.5 0 0 1-11 0Z" />
    <path d="M12 16v5.5" />
  </Svg>
)

export const IconUser = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="8" r="3.75" />
    <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
  </Svg>
)

export const IconSpark = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3 13.6 8.4 19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6Z" />
    <path d="M18.5 3.5v3M20 5h-3" opacity=".7" />
  </Svg>
)

/** Satisfied condition. Solid so it reads as a state, not an action. */
export const IconCheckCircle = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" fill="currentColor" fillOpacity=".14" />
    <path d="m8.25 12.25 2.6 2.6 5-5.4" />
  </Svg>
)

/** Unsatisfied condition needing attention. */
export const IconWarnTriangle = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.75 21 19.5H3Z" fill="currentColor" fillOpacity=".14" />
    <path d="M12 9.75v4M12 16.75h.01" />
  </Svg>
)

/** Cloud overlay mesh — Aviatrix, as distinct from a plain cloud gateway. */
export const IconCloudMesh = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.75 12.5a3.25 3.25 0 0 1 .5-6.46 4.4 4.4 0 0 1 8.4-1A3.3 3.3 0 0 1 17 12.5Z" opacity=".85" />
    <circle cx="6" cy="18.5" r="2" /><circle cx="12" cy="18.5" r="2" /><circle cx="18" cy="18.5" r="2" />
    <path d="M8 18.5h2M14 18.5h2M12 16.5v-2" />
  </Svg>
)

// ── Lookup helpers ──────────────────────────────────────────────────────────

type IconCmp = (p: IconProps) => React.ReactElement

/** BOM sub-layer → device glyph. The point of an icon here is that a reader
 *  can pick the spines out of a 200-row table without reading the column. */
const DEVICE_ICONS: Record<string, IconCmp> = {
  spine: IconSpine, 'gpu-spine': IconSpine, 'super-spine': IconSpine,
  leaf: IconLeaf, 'gpu-tor': IconLeaf, tor: IconLeaf,
  access: IconSwitch, distribution: IconSwitch, core: IconSwitch,
  'wan-edge': IconRouter, 'oran-midhaul': IconRouter, router: IconRouter,
  firewall: IconFirewall,
  'gpu-compute': IconGpu, 'oran-cu': IconServer, 'oran-du': IconServer,
  'oran-core': IconServer, server: IconServer,
  'oran-ru': IconRadio, 'oran-timing': IconRadio,
  'oran-fronthaul': IconSwitch,
  'cloud-gw': IconCloud, 'cloud-transit': IconCloud,
  'sdwan-controller': IconGlobe,
}

export function deviceIcon(subLayer: string): IconCmp {
  return DEVICE_ICONS[subLayer] ?? IconSwitch
}

/** Use-case → glyph, for the Step 1 cards. */
export const USE_CASE_ICONS: Record<string, IconCmp> = {
  campus: IconBuilding, dc: IconServer, gpu: IconGpu, wan: IconGlobe,
  multisite: IconSites, multicloud: IconCloud, aviatrix: IconCloudMesh,
  oran: IconRadio,
}
