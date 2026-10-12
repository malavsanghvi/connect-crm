// Small outline icons for the find box and the People home (decorative; the words next to them carry the meaning).

const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

export function SearchIcon({ size = 20 }: { size?: number }) {
  return (
    <svg {...common} width={size} height={size}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

export function HomeIcon() {
  return (
    <svg {...common}>
      <path d="M3 11l9-8 9 8" />
      <path d="M5 10v10h14V10" />
    </svg>
  );
}

export function ListIcon() {
  return (
    <svg {...common}>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
    </svg>
  );
}

export function LockIcon() {
  return (
    <svg {...common} width={14} height={14}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 018 0v3" />
    </svg>
  );
}

export function ChevronDownIcon() {
  return (
    <svg {...common} width={16} height={16}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
