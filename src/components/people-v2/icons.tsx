import { Icon } from "@/components/brand/icons";

/** Niva's sparkle (decorative), in the colour of the text around it: the kit's `sparkle` icon, with no gradient. */
export function SparkIcon({ size = 22 }: { size?: number }) {
  return <Icon name="sparkle" size={size} className="shrink-0" />;
}

export function SendIcon() {
  return <Icon name="send" size={18} />;
}
