import { Icon } from "@/components/brand/icons";

/** Niva's sparkle (the kit's `sparkle` icon), drawn in the current text colour. The mark that names Niva is the AI tag, not this glyph. */
export function Sparkle({ className = "h-4 w-4" }: { className?: string }) {
  return <Icon name="sparkle" className={className} />;
}
