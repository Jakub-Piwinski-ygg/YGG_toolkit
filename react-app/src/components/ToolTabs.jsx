import { motion } from 'framer-motion';
import { ART_TOOLS } from '../tools/registry.js';
import { useApp } from '../context/AppContext.jsx';

export function ToolTabs() {
  const { currentTool, setCurrentTool } = useApp();
  return (
    <div className="tool-tabs">
      {ART_TOOLS.map((t) => {
        const active = currentTool === t.meta.id;
        return (
          <motion.button
            key={t.meta.id}
            className={`tool-tab${active ? ' active' : ''}`}
            onClick={() => setCurrentTool(t.meta.id)}
            whileHover={{ x: 2 }}
            whileTap={{ scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          >
            <span className="icon">{t.meta.icon}</span>
            <span className="label">
              {t.meta.label}
              <small>{t.meta.small}</small>
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}
