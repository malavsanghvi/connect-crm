import { Icon } from "@/components/brand/icons";

// Small icons for the find box and the People home (decorative; the words next to them carry the meaning): the kit's icons at the sizes those screens use.

export function SearchIcon({ size = 20 }: { size?: number }) {
  return <Icon name="search" size={size} />;
}

export function HomeIcon() {
  return <Icon name="home" size={18} />;
}

export function ListIcon() {
  return <Icon name="list" size={18} />;
}

export function LockIcon() {
  return <Icon name="lock" size={14} />;
}

export function ChevronDownIcon() {
  return <Icon name="chevron" size={16} />;
}
