import { AppProvider } from './context/AppContext.jsx';
import { RepoBrowserProvider } from './context/RepoBrowserContext.jsx';
import { useMagick } from './hooks/useMagick.js';
import { Header } from './components/Header.jsx';
import { Sidebar } from './components/Sidebar.jsx';
import { ToolPanel } from './components/ToolPanel.jsx';
import { ResultsGrid } from './components/ResultsGrid.jsx';
import { DownloadBar } from './components/DownloadBar.jsx';
import { useApp } from './context/AppContext.jsx';
import { ART_TOOLS } from './tools/registry.js';

function OutputPanel() {
  const { outputFiles } = useApp();
  return (
    <div className="panel" style={{ flex: 1 }}>
      <div className="panel-header">
        output <span>{outputFiles.length} file{outputFiles.length !== 1 ? 's' : ''}</span>
      </div>
      <div style={{ minHeight: 150 }}>
        <ResultsGrid />
      </div>
      <DownloadBar />
    </div>
  );
}

function MainArea() {
  const { currentTool } = useApp();
  const tool = ART_TOOLS.find((t) => t.meta.id === currentTool);
  const hideOutput = tool?.meta.hideOutput === true;
  return (
    <div className="main-panel">
      <ToolPanel />
      {!hideOutput && <OutputPanel />}
    </div>
  );
}

function Shell() {
  useMagick();
  return (
    <>
      <Header />
      <div className="app-layout">
        <Sidebar />
        <MainArea />
      </div>
    </>
  );
}

export default function App() {
  return (
    <AppProvider>
      <RepoBrowserProvider>
        <Shell />
      </RepoBrowserProvider>
    </AppProvider>
  );
}
