import { useLayoutEffect, useRef, useState } from "react";

const TABS = [
  { id: "overview", label: "Overview", icon: "gauge" },
  { id: "live", label: "Live Map", icon: "map" },
  { id: "ambulances", label: "Ambulances", icon: "ambulance" },
  { id: "data", label: "Open Data", icon: "layers" },
];

// Same 20px, 1.7-stroke glyphs as the landing page nav pill.
function TabIcon({ name }) {
  const common = {
    className: "ab-ico",
    viewBox: "0 0 20 20",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  };
  if (name === "gauge") {
    return (
      <svg {...common}>
        <path d="M3.2 14.5a7 7 0 1 1 13.6 0" />
        <path d="m10 11 3.2-3.4" />
        <circle cx="10" cy="11.2" r="1.1" />
      </svg>
    );
  }
  if (name === "ambulance") {
    return (
      <svg {...common}>
        <path d="M1.8 14.2V6.4h9.4v7.8M11.2 8.6h3.3l3.3 3.2v2.4h-1.4M5.4 14.2h5.2" />
        <circle cx="4.2" cy="14.6" r="1.5" />
        <circle cx="14.4" cy="14.6" r="1.5" />
        <path d="M6.5 8.2v3.4M4.8 9.9h3.4" />
      </svg>
    );
  }
  if (name === "layers") {
    return (
      <svg {...common}>
        <path d="M10 2.5 2.5 6 10 9.5 17.5 6 10 2.5Z" />
        <path d="M2.5 10 10 13.5 17.5 10M2.5 14 10 17.5 17.5 14" />
      </svg>
    );
  }
  if (name === "map") {
    return (
      <svg {...common}>
        <path d="M2.5 5.2 7 3.2l6 2.3 4.5-2v11.3l-4.5 2-6-2.3-4.5 2V5.2Z" />
        <path d="M7 3.2v11.3M13 5.5v11.3" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x="1.8" y="1.8" width="6.8" height="6.8" rx="1.7" />
      <rect x="11.4" y="1.8" width="6.8" height="6.8" rx="1.7" />
      <rect x="1.8" y="11.4" width="6.8" height="6.8" rx="1.7" />
      <rect x="11.4" y="11.4" width="6.8" height="6.8" rx="1.7" />
    </svg>
  );
}

export function AppNav({ active, onChange, badges = {}, live }) {
  const listRef = useRef(null);
  const [thumb, setThumb] = useState(null);

  // Measure the active tab so the navy thumb can slide under it.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return undefined;
    function measure() {
      const node = list.querySelector(`[data-tab="${active}"]`);
      if (!node) return;
      setThumb({ left: node.offsetLeft, width: node.offsetWidth });
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    document.fonts?.ready?.then(measure);
    return () => observer.disconnect();
  }, [active]);

  return (
    <nav className="ab-nav" aria-label="Views">
      <div className="ab-list" ref={listRef} role="tablist">
        {thumb && <span className="ab-thumb" style={{ transform: `translateX(${thumb.left}px)`, width: thumb.width }} aria-hidden="true" />}
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            data-tab={tab.id}
            aria-selected={active === tab.id}
            className={active === tab.id ? "ab-item is-on" : "ab-item"}
            onClick={() => onChange(tab.id)}
          >
            <TabIcon name={tab.icon} />
            <span className="ab-label">{tab.label}</span>
            {tab.id === "live" && live && <i className="ab-live" aria-label="Live" />}
            {tab.id === "ambulances" && badges.ambulances > 0 && <em className="ab-badge is-alert">{badges.ambulances}</em>}
            {tab.id !== "ambulances" && badges[tab.id] > 0 && <em className="ab-badge">{badges[tab.id]}</em>}
          </button>
        ))}
      </div>
    </nav>
  );
}
