# NDAL v2.0 — React Migration Plan
> Status: **READY TO EXECUTE** (next cycle)
> Author: Amit Tiwari via Claude Code
> Branch strategy: All migration work on `feature/react-migration` → merge to `main` only on Phase 4 completion

---

## Why Migrate

The v1.0 monolith (`index.html` + vanilla JS) has reached its maintainability ceiling:
- 2,500+ line HTML file; 2,200+ line `init.js` — no code splitting possible
- Global `window.*` namespace collisions between modules
- No hot-module reload — every change requires full page refresh
- No type safety — silent runtime errors on intent object mutations
- Single-threaded SVG rendering blocks UI during large topology builds
- GitHub Pages CI/CD already available — removing the "no build step" constraint is the unlock

The v1.0 vanilla implementation (G-01–G-65) closes the feature gap to ~85% of what React enables. The remaining 15% (drag-drop topology, virtual scroll at 5000+ devices, CodeMirror syntax engine, Capacitor mobile) requires React.

**Trigger condition met**: G-65 completed. All vanilla gaps closed. Migration is the right next investment.

---

## Target Stack (v2.0)

| Layer | Technology | Reason |
|-------|-----------|--------|
| Framework | React 18 + TypeScript 5 | Concurrent rendering, strict types |
| Build | Vite 5 | Fast HMR, ESM output, GH Pages plugin |
| State | Zustand 4 | Drop-in replacement for global `STATE` object |
| Topology | @xyflow/react 12 | Drag/drop, auto-layout, edge routing |
| Tables | TanStack Table v8 | Virtual scroll, column pinning, row grouping |
| Config viewer | CodeMirror 6 | Real IOS-XE/NX-OS/EOS language modes |
| UI components | Shadcn/UI + Tailwind CSS v4 | Accessible, composable, zero-runtime |
| Routing | React Router v7 | Deep-link to steps, share intent URLs |
| Testing | Vitest + RTL + Playwright | Unit, component, E2E |
| Mobile | Capacitor 6 | iOS + Android shell from same codebase |
| CI/CD | GitHub Actions | Build → test → deploy to GitHub Pages |

---

## Architecture Decisions

### State: Zustand store mirrors intent object
```typescript
// src/store/intentStore.ts
interface IntentStore {
  intent: IntentObject;        // exact same schema as CLAUDE.md §3
  setIntent: (patch: Partial<IntentObject>) => void;
  resetIntent: () => void;
}
export const useIntentStore = create<IntentStore>(...);
```

All domain logic modules (`bom_calculator`, `configgen`, `hld_diagram`) become pure TypeScript functions that take `IntentObject` and return data — no DOM side effects. React components call them and render the results.

### Routing: steps are URL segments
```
/                     → Step 1 (use case)
/bom                  → Step 2 (BOM + topology)
/config               → Step 3 (config viewer)
/deploy               → Step 4 (deployment pipeline)
/monitor              → Step 5 (monitoring)
/ztp                  → Step 6 (ZTP)
/tools                → Step 7 (engine + integrations)
```
Back button works. Deep links share state via URL search params (`?intent=<base64>`).

### Docker: add build stage, keep offline target
```dockerfile
# Dockerfile.frontend (new)
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build          # vite build → dist/

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
```
GitHub Pages gets the `dist/` output. Docker offline target gets the nginx-served build artifact. Both use the same build.

---

## Phase 1 — Foundation (Weeks 1–2)

**Goal**: Vite + React scaffold compiles and deploys. No features migrated yet. CI/CD green.

### 1.1 Repo structure
```
network-automation/
  index.html           ← v1.0 kept at root (GitHub Pages fallback)
  react-app/           ← new React app lives here during migration
    src/
      components/
      store/
      hooks/
      domain/          ← ported pure-function modules from src/js/
      pages/
    public/
      manifest.json
      sw.js
    vite.config.ts
    tsconfig.json
    package.json
  .github/
    workflows/
      ci.yml
      deploy.yml
```

### 1.2 GitHub Actions CI (`.github/workflows/ci.yml`)
```yaml
name: CI
on: [push, pull_request]
jobs:
  build-and-test:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: react-app
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm', cache-dependency-path: 'react-app/package-lock.json' }
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm run test:unit
      - run: npm run build
      - run: npm run test:e2e      # Playwright headless
```

### 1.3 GitHub Actions Deploy (`.github/workflows/deploy.yml`)
```yaml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    defaults:
      run:
        working-directory: react-app
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm', cache-dependency-path: 'react-app/package-lock.json' }
      - run: npm ci && npm run build
      - uses: peaceiris/actions-gh-pages@v4
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./react-app/dist
          cname: netdesignai.com
```

### 1.4 Vite config
```typescript
// react-app/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          xyflow: ['@xyflow/react'],
          codemirror: ['@codemirror/state', '@codemirror/view'],
        }
      }
    }
  }
});
```

### 1.5 Deliverables
- [ ] `react-app/` scaffold with React 18 + TypeScript + Vite
- [ ] Tailwind CSS + Shadcn/UI installed
- [ ] Zustand store wired with IntentObject type (mirrors CLAUDE.md §3 schema exactly)
- [ ] CI workflow: typecheck + lint + unit tests + build
- [ ] Deploy workflow: push to main → GitHub Pages via `dist/`
- [ ] Empty placeholder routes for all 7 steps render without error
- [ ] Docker `Dockerfile.frontend` builds and serves on port 80

---

## Phase 2 — Domain Logic Port (Weeks 3–5)

**Goal**: All network domain logic ported to typed TypeScript. No React dependencies — pure functions only. Tests cover all formulas.

### 2.1 Files to port (src/js → react-app/src/domain/)

| v1.0 file | v2.0 module | Key exports |
|-----------|------------|-------------|
| `bom_calculator.js` | `domain/bom.ts` | `calculateBOM(intent): BOMResult` |
| `products.js` | `domain/products.ts` | `PRODUCTS: Product[]`, `getLifecycleStatus()` |
| `configgen.js` | `domain/configgen.ts` | `generateConfig(device, intent): string` |
| `hld_diagram.js` (logic) | `domain/topology.ts` | `buildTopologyGraph(intent): TopologyGraph` |
| `intent_constraints.js` | `domain/constraints.ts` | `validateIntent(intent): ValidationResult[]` |
| `tco.js` | `domain/tco.ts` | `calculateTCO(bom, intent): TCOResult` |
| `optics.js` | `domain/optics.ts` | `recommendOptics(link): Optic` |
| `cabling.js` | `domain/cabling.ts` | `generateCableSchedule(topology): Cable[]` |
| `racklayout.js` | `domain/rack.ts` | `assignRackLayout(bom): RackLayout` |
| `rollback.js` | `domain/rollback.ts` | `ROLLBACK_STRATEGIES` typed map |
| `troubleshoot.js` | `domain/troubleshoot.ts` | `SYMPTOM_DB`, `bgpConvergencePredictor()` |
| `ztp.js` | `domain/ztp.ts` | `genDay0Config()`, `genZtpDockerCompose()` |

**Port rule**: Each module is a TypeScript file with zero imports from React or browser APIs. All functions take plain objects, return plain objects or strings. This makes them testable in Node (Vitest) without a DOM.

### 2.2 Type definitions
```typescript
// react-app/src/types/intent.ts — exact schema from CLAUDE.md §3
export interface IntentObject {
  use_case: UseCaseType;
  org: OrgConfig;
  vendors: VendorType[];
  industry: string;
  topology: TopologyConfig;
  protocols: ProtocolConfig;
  security: SecurityConfig;
  applications: ApplicationConfig;
  gpu: GPUConfig;
  cloud: CloudConfig;
}
```

### 2.3 Unit tests
```
react-app/src/domain/__tests__/
  bom.test.ts          ← calculateBOM with 5 fixtures; verify leaf/spine counts
  constraints.test.ts  ← all 8 R-01→R-08 rules fire correctly
  configgen.test.ts    ← golden-file diff for NX-OS leaf EVPN config
  topology.test.ts     ← dc_fabric → correct node/edge counts
```

### 2.4 Deliverables
- [ ] All 12 domain modules ported to TypeScript with zero type errors
- [ ] BOM formulas produce identical output to v1.0 (golden-file test)
- [ ] Config generator produces identical output to v1.0 for 3 platforms (NX-OS/EOS/JunOS)
- [ ] Constraint rules R-01→R-08 covered by unit tests
- [ ] CI runs domain tests on every push

---

## Phase 3 — React UI (Weeks 6–9)

**Goal**: Full feature-parity UI in React. v1.0 index.html can be retired.

### 3.1 Component tree
```
<App>
  <Router>
    <AppShell>          ← header, sidebar, theme, command palette
      <Step1Page />     ← use case selector
      <Step2Page />     ← requirements form + BOM table + topology
      <Step3Page />     ← config viewer with CodeMirror
      <Step4Page />     ← deployment pipeline
      <Step5Page />     ← monitoring
      <Step6Page />     ← ZTP
      <Step7Page />     ← tools (policy editor, integrations)
    </AppShell>
  </Router>
</App>
```

### 3.2 Key component implementations

**Topology — @xyflow/react**
```typescript
// components/topology/TopologyCanvas.tsx
import { ReactFlow, Background, Controls, MiniMap } from '@xyflow/react';

export function TopologyCanvas({ intent }: { intent: IntentObject }) {
  const { nodes, edges } = buildTopologyGraph(intent);  // domain function
  return (
    <ReactFlow nodes={nodes} edges={edges} fitView>
      <Background />
      <Controls />
      <MiniMap />   {/* replaces G-52 custom minimap */}
    </ReactFlow>
  );
}
```
This replaces 700+ lines of SVG string-building in `hld_diagram.js` with declarative nodes/edges. Drag-drop, auto-layout, zoom, and minimap come for free.

**BOM Table — TanStack Table**
```typescript
// components/bom/BOMTable.tsx
import { useReactTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel } from '@tanstack/react-table';
// Column virtualisation via @tanstack/react-virtual for 5000+ device BOM
```
Replaces `bomSortBy`/`bomFilter`/`bomRenderTable` hand-rolled sort/filter from G-45.

**Config Viewer — CodeMirror 6**
```typescript
// components/config/ConfigViewer.tsx
import { EditorView } from '@codemirror/view';
import { nxosLanguage } from './languages/nxos';  // custom grammar
// Lazy-loaded: dynamic import(() => import('@codemirror/view'))
```
Replaces `highlightNetCLI` regex hack from G-44. Real parser = correct highlighting for all edge cases.

**State — Zustand**
```typescript
// Replaces global window.STATE — same shape, React-friendly
const { intent, setIntent } = useIntentStore();
// All domain calls: const bom = calculateBOM(intent, leafSku, spineSku);
```

### 3.3 Feature parity checklist

| Feature | v1.0 | v2.0 |
|---------|------|------|
| Intent object → all outputs | G-01–G-42 logic | Same domain fns, React renders |
| Interactive topology | G-43 pan/zoom | @xyflow/react (drag-drop + more) |
| Config syntax highlighting | G-44 regex | CodeMirror 6 real grammar |
| BOM sort/filter | G-45 hand-rolled | TanStack Table |
| PWA | G-46 sw.js | Vite PWA plugin (workbox) |
| Command palette | G-47 IIFE | `cmdk` library (fully accessible) |
| PNG/SVG/Draw.io export | G-48/59 | ReactFlow → html2canvas / xml serialize |
| Policy editor | G-49 IIFE | React component with drag-drop rules |
| Config diff | G-50 LCS | `diff` npm package + CodeMirror merge view |
| Section folding | G-51 `<details>` | CodeMirror foldable regions |
| Mini-map | G-52 custom | ReactFlow `<MiniMap>` |
| ARIA accessibility | G-53 manual | Shadcn/UI (ARIA built in to all components) |
| Theme | G-54 CSS vars | Tailwind dark mode + `next-themes` |
| Resizable panel | G-55 pointer drag | `react-resizable-panels` |
| Node click drill-down | G-56 | ReactFlow `onNodeClick` |
| Layer toggles | G-57 | ReactFlow node/edge type filtering |
| Hover tooltips | G-58 | ReactFlow custom node tooltips |
| Loading skeletons | G-60 | Shadcn/UI `<Skeleton>` |
| Error boundary | G-61 | React `<ErrorBoundary>` + Sentry |
| Multi-device compare | G-62 | CodeMirror merge view |
| Section filter tabs | G-63 | CodeMirror search panel |
| Mobile bottom nav | G-64 | Shadcn/UI tabs + responsive |
| Mobile FABs | G-65 | Shadcn/UI FAB pattern |

### 3.4 Playwright E2E tests
```
react-app/e2e/
  step1-usecase.spec.ts       ← select dc_fabric → intent updates
  step2-bom.spec.ts           ← 500 endpoints → correct leaf count
  step3-config.spec.ts        ← NX-OS config renders, syntax highlighted
  topology-interaction.spec.ts ← drag node, zoom, click → config drill-down
  mobile.spec.ts              ← 375px viewport, bottom nav, FABs
  export.spec.ts              ← PNG download, SVG download, Draw.io
```

### 3.5 Deliverables
- [ ] All 7 step pages render with correct domain logic output
- [ ] @xyflow/react topology: drag, zoom, click-to-config, layer filter
- [ ] CodeMirror 6 config viewer: all 7 platforms, folding, diff, compare
- [ ] TanStack Table BOM: sort, filter, virtual scroll (5000 rows smooth)
- [ ] Shadcn/UI + Tailwind: light/dark theme, all ARIA labels
- [ ] Command palette via `cmdk`
- [ ] Policy editor drag-drop rules
- [ ] Playwright E2E suite green in CI
- [ ] Lighthouse score ≥ 90 on all 4 axes

---

## Phase 4 — Mobile + Launch (Weeks 10–12)

**Goal**: Capacitor iOS/Android shell. v1.0 `index.html` retired. `main` branch updated.

### 4.1 Capacitor setup
```bash
cd react-app
npm install @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android
npx cap init "NetDesign AI" "com.netdesignai.app"
npm run build
npx cap add ios
npx cap add android
npx cap sync
```

### 4.2 Native features
- `@capacitor/filesystem` — save configs to device Files app
- `@capacitor/share` — share topology PNG via iOS/Android share sheet
- `@capacitor/network` — detect offline → show cached topology warning
- `@capacitor/preferences` — persist intent object natively (supplements localStorage)

### 4.3 CI additions for mobile
```yaml
# .github/workflows/ci.yml additions
  build-ios:
    runs-on: macos-latest
    steps:
      - run: npm ci && npm run build
      - run: npx cap sync ios
      - run: xcodebuild -workspace react-app/ios/App/App.xcworkspace \
               -scheme App -destination 'platform=iOS Simulator' build
  build-android:
    runs-on: ubuntu-latest
    steps:
      - run: npm ci && npm run build
      - run: npx cap sync android
      - run: cd react-app/android && ./gradlew assembleDebug
```

### 4.4 Retirement checklist
- [ ] Remove `index.html` from repo root (redirect to `/react-app/dist/`)
- [ ] Update `CLAUDE.md` §1 stack to `React 18 + TypeScript + Vite`
- [ ] Update `docker-compose.local.yml` to use `Dockerfile.frontend`
- [ ] Archive all `src/js/*.js` files to `legacy/` (keep for reference, not loaded)
- [ ] Update `sw.js` to Vite PWA plugin (workbox) generated manifest
- [ ] Push `feature/react-migration` → PR → merge to `main`
- [ ] Tag `v2.0.0` release

---

## Docker Compose Changes

```yaml
# docker-compose.local.yml — add/replace frontend service
  frontend:
    build:
      context: ./react-app
      dockerfile: Dockerfile.frontend
    ports: ["80:80"]
    depends_on: [backend]
    environment:
      - VITE_API_BASE_URL=http://backend:5000

  # backend unchanged — Flask + Nornir + Netmiko
  backend:
    build: ./backend
    ports: ["5000:5000"]
    environment:
      - NET_USER=${NET_USER}
      - NET_PASS=${NET_PASS}
      - NET_ENABLE=${NET_ENABLE}
```

**Offline target preserved**: `docker-compose up` still works with no internet — the nginx container serves the pre-built `dist/` from the build stage.

---

## Dependency Budget

| Package | Size (gzipped) | Purpose |
|---------|---------------|---------|
| react + react-dom | ~45 KB | Framework |
| @xyflow/react | ~85 KB | Topology canvas |
| @codemirror/* (lazy) | ~120 KB | Config viewer (loaded on demand) |
| @tanstack/react-table | ~15 KB | BOM table |
| zustand | ~3 KB | State |
| tailwindcss (CSS only) | ~12 KB | Styling (purged) |
| cmdk | ~12 KB | Command palette |
| react-resizable-panels | ~8 KB | Resizable config panel |
| **Total initial bundle** | **~200 KB** | (CodeMirror lazy-loaded separately) |

Target: initial JS bundle < 200 KB gzipped. CodeMirror loads only when config step is active.

---

## Go / No-Go Criteria

**Go** when ALL of:
- CI pipeline runs in < 4 minutes
- All domain unit tests passing (coverage ≥ 80%)
- All Playwright E2E green on Chrome + Safari + Firefox
- Lighthouse performance ≥ 90 on mobile viewport
- Docker offline build produces working container

**No-go** if:
- Bundle size exceeds 400 KB gzipped (indicates poor code splitting)
- Any domain formula produces different output vs v1.0 golden files
- iOS/Android Capacitor build fails CI

---

## Timeline

| Week | Phase | Milestone |
|------|-------|-----------|
| 1 | Phase 1 | Vite scaffold + CI/CD green |
| 2 | Phase 1 | Docker build + empty routes deployed |
| 3–4 | Phase 2 | BOM + constraint domain modules typed + tested |
| 5 | Phase 2 | Config + topology domain modules typed + tested |
| 6–7 | Phase 3 | Steps 1–3 React UI (intent → BOM → config) |
| 8–9 | Phase 3 | Steps 4–7 React UI + E2E suite |
| 10 | Phase 4 | Capacitor iOS + Android shell builds |
| 11 | Phase 4 | Lighthouse audit, performance tuning |
| 12 | Phase 4 | v1.0 retired, v2.0.0 tagged, `main` updated |

---

## Session Quick-Start for Next Cycle

When starting migration work, use this prompt:

```
Using REACT_MIGRATION_PLAN.md as context:
Begin Phase 1. Create react-app/ scaffold with:
- React 18 + TypeScript 5 + Vite 5
- Tailwind CSS v4 + Shadcn/UI
- Zustand 4 with IntentObject type from CLAUDE.md §3
- React Router v7 with 7 routes (/bom /config /deploy /monitor /ztp /tools)
- .github/workflows/ci.yml: typecheck + lint + vitest + build
- .github/workflows/deploy.yml: push main → GitHub Pages via peaceiris/actions-gh-pages
- Dockerfile.frontend: node:20-alpine build stage + nginx:alpine serve
Create the branch feature/react-migration first.
All credentials via environment variables NET_USER, NET_PASS, NET_ENABLE.
NEVER hardcode credentials.
```
