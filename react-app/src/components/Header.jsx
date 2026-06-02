import { CategoryTabs } from './CategoryTabs.jsx';

export function Header() {
  return (
    <header>
      <div className="header-logo">
        <a href="https://yggdrasilgaming.com">
          <img
            src="https://yggdrasilgaming.com/w/files/2020/07/symbol.png"
            alt="Yggdrasil Gaming Logo"
            style={{ width: 70, display: 'block' }}
          />
        </a>
        <div className="header-title-wrap">
          <h1>YGG&nbsp;&nbsp;&nbsp;TOOLKIT</h1>
        </div>
      </div>
      <div className="header-categories-wrap">
        <CategoryTabs placement="header" />
      </div>
    </header>
  );
}
