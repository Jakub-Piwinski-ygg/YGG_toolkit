import { Dropzone } from './Dropzone.jsx';
import { FileList } from './FileList.jsx';
import { ToolTabs } from './ToolTabs.jsx';

export function Sidebar() {
  return (
    <div className="sidebar">
      <Dropzone />
      <FileList />
      <div className="separator" />
      <ToolTabs />
    </div>
  );
}
