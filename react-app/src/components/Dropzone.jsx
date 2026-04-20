import { useRef, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';

export function Dropzone() {
  const { addFiles } = useApp();
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const files = [...e.dataTransfer.files].filter(
      (f) => f.type === 'image/png' || f.name.endsWith('.png')
    );
    addFiles(files);
  };

  return (
    <>
      <div
        className={`dropzone${dragging ? ' drag-over' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <span className="drop-icon">📂</span>
        drop PNG files here<br />or click to browse
      </div>
      <input
        ref={inputRef}
        id="fileInput"
        type="file"
        accept=".png,image/png"
        multiple
        onChange={(e) => {
          addFiles([...e.target.files]);
          e.target.value = '';
        }}
      />
    </>
  );
}
