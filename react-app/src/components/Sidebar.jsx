import { Dropzone } from './Dropzone.jsx';
import { FileList } from './FileList.jsx';
import { ToolTabs } from './ToolTabs.jsx';
import { useApp } from '../context/AppContext.jsx';

export function Sidebar() {
  const { currentCategory } = useApp();
  const isArtTools = currentCategory === 'arttools';
  const isAssetPipeline = currentCategory === 'review';

  return (
    <div className={`sidebar sidebar-${currentCategory}`}>
      {isArtTools ? (
        <>
          <Dropzone />
          <FileList />
          <div className="separator" />
        </>
      ) : null}
      {isArtTools || isAssetPipeline ? <ToolTabs placement="sidebar" /> : null}
    </div>
  );
}
