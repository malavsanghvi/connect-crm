import { useId } from "react";

// The Weaver mark: a "W" made of one flowing ribbon with a sun above its middle peak. Drawn as a vector from the logo
// the owner supplied on 2026-10-08 (the original file was not available, so this is a redraw; swapping in the original
// artwork means replacing the shapes below, src/app/icon.svg, src/app/apple-icon.tsx and src/app/favicon.ico).
// The app icon / favicon (src/app/icon.svg) is the same drawing: tests/brand.test.ts keeps them in step.

/** The silhouette of the W (the clip for the shading). */
export const WEAVER_SILHOUETTE_D =
  "M370,535 C520,535 640,650 700,800 C740,900 765,990 790,1075 C850,990 900,925 965,925 C1030,925 1085,990 1140,1075 C1230,830 1330,535 1560,535 C1650,535 1675,625 1620,690 C1560,760 1500,800 1460,880 C1400,1030 1370,1150 1330,1255 C1280,1340 1230,1397 1170,1397 C1090,1397 1040,1320 965,1175 C900,1290 840,1397 760,1397 C680,1397 630,1330 600,1250 C540,1080 500,950 470,860 C430,770 380,725 330,685 C285,645 275,610 285,585 C300,548 330,535 370,535 Z";

/** The mark's square view box (the drawing is centred in it). */
export const WEAVER_VIEW_BOX = "170 166 1600 1600";

/**
 * The mark as SVG elements, without hooks (so the social and app-icon images, which are drawn outside React, can use it).
 * `id` keeps the gradient ids unique when the mark appears more than once on a page.
 */
export function weaverMarkSvg(id: string, props: { className?: string; width?: number; height?: number; title?: string } = {}) {
  const g = (name: string) => `${id}-${name}`;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={WEAVER_VIEW_BOX}
      width={props.width}
      height={props.height}
      className={props.className}
      role={props.title ? "img" : undefined}
      aria-label={props.title}
      aria-hidden={props.title ? undefined : true}
      focusable="false"
    >
      <defs>
        <linearGradient id={g("base")} gradientUnits="userSpaceOnUse" x1="300" y1="560" x2="1640" y2="640">
          <stop offset="0" stopColor="#34c4cb" />
          <stop offset="0.5" stopColor="#2f8ed8" />
          <stop offset="1" stopColor="#6cc68f" />
        </linearGradient>
        <linearGradient id={g("wash")} gradientUnits="userSpaceOnUse" x1="960" y1="700" x2="960" y2="1300">
          <stop offset="0" stopColor="#2a6fe3" stopOpacity="0" />
          <stop offset="1" stopColor="#2a6fe3" stopOpacity="0.55" />
        </linearGradient>
        <linearGradient id={g("dark")} gradientUnits="userSpaceOnUse" x1="990" y1="1000" x2="700" y2="1400">
          <stop offset="0" stopColor="#1a7fc6" stopOpacity="0" />
          <stop offset="0.45" stopColor="#1676c4" stopOpacity="0.85" />
          <stop offset="1" stopColor="#1c56b0" />
        </linearGradient>
        <linearGradient id={g("purple")} gradientUnits="userSpaceOnUse" x1="1010" y1="1090" x2="1290" y2="1400">
          <stop offset="0" stopColor="#3d3bb8" />
          <stop offset="1" stopColor="#7a69da" />
        </linearGradient>
        <linearGradient id={g("sun")} gradientUnits="userSpaceOnUse" x1="1060" y1="580" x2="880" y2="860">
          <stop offset="0" stopColor="#ffb82a" />
          <stop offset="1" stopColor="#ff7640" />
        </linearGradient>
        <clipPath id={g("w")}>
          <path d={WEAVER_SILHOUETTE_D} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${g("w")})`}>
        <rect x="250" y="500" width="1450" height="950" fill={`url(#${g("base")})`} />
        <rect x="250" y="700" width="1450" height="700" fill={`url(#${g("wash")})`} />
        <path d="M598,1256 C690,1246 752,1170 792,1076 C850,1000 905,930 965,925 L965,1175 L965,1420 L560,1420 Z" fill={`url(#${g("dark")})`} />
        <path d="M968,1176 C1010,1108 1060,1068 1112,1068 C1220,1170 1272,1256 1332,1258 L1332,1420 L968,1420 Z" fill={`url(#${g("purple")})`} />
      </g>
      <circle cx="965" cy="718" r="152" fill={`url(#${g("sun")})`} />
    </svg>
  );
}

/** The Weaver mark. Decorative unless a `title` is given. */
export function WeaverMark({ className = "h-8 w-8", title }: { className?: string; title?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return weaverMarkSvg(`wm${id}`, { className, title });
}
