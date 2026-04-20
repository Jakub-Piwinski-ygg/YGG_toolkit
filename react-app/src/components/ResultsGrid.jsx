import { motion, AnimatePresence } from 'framer-motion';
import { useApp } from '../context/AppContext.jsx';
import { triggerDownload } from '../utils/download.js';

export function ResultsGrid() {
  const { outputFiles } = useApp();

  if (!outputFiles.length) {
    return <div className="empty-state">processed images will appear here</div>;
  }

  return (
    <div className="results-grid">
      <AnimatePresence initial={false}>
        {outputFiles.map((f) => (
          <motion.div
            key={f.name}
            className="result-card"
            onClick={() => triggerDownload(f.url, f.name)}
            title="Click to download"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.18 }}
          >
            <img src={f.url} alt={f.name} loading="lazy" />
            <div className="rc-label">{f.name}</div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
