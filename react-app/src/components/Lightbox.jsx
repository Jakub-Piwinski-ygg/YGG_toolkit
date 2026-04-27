import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export function Lightbox({ open, src, name, onClose, onDownload, onSendToTools }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="ab-lightbox"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <motion.img
            src={src}
            alt={name}
            initial={{ scale: 0.95 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0.95 }}
            transition={{ duration: 0.18 }}
          />
          <div className="ab-lightbox-info" onClick={(e) => e.stopPropagation()}>
            <span className="ab-lightbox-name">{name}</span>
            {onSendToTools && (
              <button
                className="btn ab-lightbox-btn ab-lightbox-btn-accent"
                onClick={(e) => { e.stopPropagation(); onSendToTools(); onClose(); }}
              >
                + Art Tools
              </button>
            )}
            {onDownload && (
              <button
                className="btn ab-lightbox-btn"
                onClick={(e) => { e.stopPropagation(); onDownload(); }}
              >
                ↓ Download
              </button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
