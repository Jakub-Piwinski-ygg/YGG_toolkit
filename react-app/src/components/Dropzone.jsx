import { useRef, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';

const ACCEPT_RE = /\.(png|jpe?g|webp|gif|bmp|webm|mp4|mov|m4v)$/i;

export function Dropzone() {
  const { addFiles } = useApp();
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const files = [...e.dataTransfer.files].filter((f) => ACCEPT_RE.test(f.name));
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
        drop images or video here<br />
        <span style={{ fontSize: '.65rem', opacity: 0.7 }}>png · jpg · webp · gif · bmp · webm · mp4</span>
      </div>
      <input
        ref={inputRef}
        id="fileInput"
        type="file"
        accept=".png,.jpg,.jpeg,.webp,.gif,.bmp,.webm,.mp4,.mov,.m4v,image/*,video/webm,video/mp4"
        multiple
        onChange={(e) => {
          addFiles([...e.target.files]);
          e.target.value = '';
        }}
      />
    </>
  );
}
