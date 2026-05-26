import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { Step1UseCasePage } from '@/pages/Step1UseCasePage';
import { Step2BOMPage } from '@/pages/Step2BOMPage';
import { PlaceholderPage } from '@/pages/PlaceholderPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AppShell />}>
          <Route index element={<Step1UseCasePage />} />
          <Route path="bom" element={<Step2BOMPage />} />
          <Route
            path="config"
            element={
              <PlaceholderPage
                step={3}
                title="Config Generator"
                icon="📄"
                sourceFile="src/js/configgen.js"
                description="Per-device configs for NX-OS, EOS, JunOS, IOS-XE, IOS-XR, SONiC, FortiOS, PAN-OS with CodeMirror 6 syntax highlighting."
                prev="/bom"
                next="/deploy"
              />
            }
          />
          <Route
            path="deploy"
            element={
              <PlaceholderPage
                step={4}
                title="Deploy & Validate"
                icon="🚀"
                sourceFile="src/js/deploy.js, checks.js, rollback.js"
                description="Pre-checks, canary deploy, Batfish dry-run, post-checks, drift detection, platform-native rollback."
                prev="/config"
                next="/monitor"
              />
            }
          />
          <Route
            path="monitor"
            element={
              <PlaceholderPage
                step={5}
                title="Monitoring"
                icon="📊"
                sourceFile="src/js/monitoring.js"
                description="VictoriaMetrics + Grafana stack, gNMI telemetry, anomaly detection, convergence predictor."
                prev="/deploy"
                next="/ztp"
              />
            }
          />
          <Route
            path="ztp"
            element={
              <PlaceholderPage
                step={6}
                title="Zero-Touch Provisioning"
                icon="📡"
                sourceFile="src/js/ztp.js"
                description="POAP/EOS-ZTP/PnP/Junos-ZTP, 9-state machine, Day-0 bootstrap, OS image catalog."
                prev="/monitor"
                next="/tools"
              />
            }
          />
          <Route
            path="tools"
            element={
              <PlaceholderPage
                step={7}
                title="Engine & Tools"
                icon="⚙️"
                sourceFile="src/js/troubleshoot.js, policy_editor.js"
                description="Troubleshoot, policy editor, ZTP file server, integrations (Slack/ServiceNow/Jira/GitHub/NetBox)."
                prev="/ztp"
              />
            }
          />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
