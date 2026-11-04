import { useEffect } from 'react';
import { importFiles } from '../editor/actions';
import { fitToStage, Stage } from '../editor/Stage';
import { store, useApp } from '../editor/state';
import { Timeline } from '../timeline/Timeline';
import { Dialogs, Toasts } from './Dialogs';
import { PropertiesPanel } from './PropertiesPanel';
import { StageHeader } from './StageHeader';
import { ToolRail } from './ToolRail';
import { Tooltip } from './Tooltip';
import { TopBar } from './TopBar';

export function App() {
  const s = useApp((st) => ({ ready: st.ready, panels: st.panels }));

  useEffect(() => {
    const onFiles = (e: Event) => void importFiles((e as CustomEvent<File[]>).detail);
    const onFit = () => requestAnimationFrame(fitToStage);
    window.addEventListener('studio:import-files', onFiles);
    window.addEventListener('studio:fit', onFit);
    return () => { window.removeEventListener('studio:import-files', onFiles); window.removeEventListener('studio:fit', onFit); };
  }, []);

  if (!s.ready) return <div className="boot" role="status">Loading your project…</div>;

  return (
    <div className="app">
      <TopBar />
      <div className="workspace">
        {s.panels.tools && <ToolRail />}
        <main className="center" aria-label="Drawing panel">
          <StageHeader />
          <Stage />
        </main>
        {s.panels.properties && <PropertiesPanel />}
      </div>
      {s.panels.timeline ? <Timeline /> : <div />}
      <Dialogs />
      <Toasts />
      <Tooltip />
    </div>
  );
}

export { store };
