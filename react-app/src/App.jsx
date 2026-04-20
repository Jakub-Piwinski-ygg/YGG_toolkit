import { AppProvider } from './context/AppContext.jsx';
import { useMagick } from './hooks/useMagick.js';
import { Header } from './components/Header.jsx';
import { Sidebar } from './components/Sidebar.jsx';
import { ToolPanel } from './components/ToolPanel.jsx';
import { ResultsGrid } from './components/ResultsGrid.jsx';
import { DownloadBar } from './components/DownloadBar.jsx';
import { useApp } from './context/AppContext.jsx';

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

function Shell() {
  useMagick();
  return (
    <>
      <Header />
      <div className="app-layout">
        <Sidebar />
        <div className="main-panel">
          <ToolPanel />
          <OutputPanel />
        </div>
      </div>
    </>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
