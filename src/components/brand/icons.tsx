import { ICON_MARKUP, type IconName } from "@/components/brand/icons.generated";

export type { IconName };

// The Weaver icon set (brand/icons/*.svg, 24px grid, stroke 2, round caps and joins, no fill), drawn in the colour of the text around
// it. One component for the website and the portal; the shapes are generated from the kit's own files (scripts/sync-brand-tokens.mjs),
// so an icon added to brand/icons is available here after a run of the script. Icons are decorative: the words beside them carry the
// meaning. `filled` fills the shape with the text colour (a pinned star). `strokeWidth` is 2 unless a tiny tick needs a heavier line.
export function Icon({
  name,
  className = "h-5 w-5",
  strokeWidth = 2,
  filled = false,
}: {
  name: IconName;
  className?: string;
  strokeWidth?: number;
  filled?: boolean;
}) {
  return (
    <svg
      aria-hidden
      focusable="false"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      // The markup is generated from the repository's own brand/icons files, never from user input.
      dangerouslySetInnerHTML={{ __html: ICON_MARKUP[name] }}
    />
  );
}
