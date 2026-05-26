import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { Step1UseCasePage } from '@/pages/Step1UseCasePage';
import { Step2BOMPage } from '@/pages/Step2BOMPage';
import { Step3ConfigPage } from '@/pages/Step3ConfigPage';
import { Step4DeployPage } from '@/pages/Step4DeployPage';
import { Step5MonitorPage } from '@/pages/Step5MonitorPage';
import { Step6ZTPPage } from '@/pages/Step6ZTPPage';
import { Step7ToolsPage } from '@/pages/Step7ToolsPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AppShell />}>
          <Route index          element={<Step1UseCasePage />} />
          <Route path="bom"     element={<Step2BOMPage />} />
          <Route path="config"  element={<Step3ConfigPage />} />
          <Route path="deploy"  element={<Step4DeployPage />} />
          <Route path="monitor" element={<Step5MonitorPage />} />
          <Route path="ztp"     element={<Step6ZTPPage />} />
          <Route path="tools"   element={<Step7ToolsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
