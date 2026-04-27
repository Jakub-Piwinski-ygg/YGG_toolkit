import { TOOL_CATEGORIES } from '../tools/registry.js';
import { useApp } from '../context/AppContext.jsx';

export function CategoryTabs() {
  const { currentCategory, setCurrentCategory, setCurrentTool } = useApp();

  const handleSwitch = (catId) => {
    if (catId === currentCategory) return;
    setCurrentCategory(catId);
    const cat = TOOL_CATEGORIES.find((c) => c.id === catId);
    if (cat?.tools.length) setCurrentTool(cat.tools[0].meta.id);
  };

  return (
    <div className="sidebar-categories">
      {TOOL_CATEGORIES.map((c) => (
        <button
          key={c.id}
          className={`category-tab${currentCategory === c.id ? ' active' : ''}`}
          onClick={() => handleSwitch(c.id)}
          title={c.label}
        >
          <span>{c.icon}</span>
          <span>{c.label}</span>
        </button>
      ))}
    </div>
  );
}
