"use client";

import { brandColor } from "@/lib/brand-colors";
import { POSTER_ICONS, POSTER_ICON_LABEL, posterIconUri, type PosterIcon } from "@/lib/events/flyer-icons";

const INK = brandColor("navy");

/** A row of icon buttons (the built-in icon library); one is chosen. Shared by the poster's highlight box and the layouts' note box. */
export function IconPicker({ label, value, onChange, disabled }: { label: string; value: PosterIcon; onChange: (v: PosterIcon) => void; disabled: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {POSTER_ICONS.map((icon) => {
        const on = icon === value;
        return (
          <button
            key={icon}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={POSTER_ICON_LABEL[icon]}
            title={POSTER_ICON_LABEL[icon]}
            disabled={disabled}
            onClick={() => onChange(icon)}
            className={`flex h-11 w-11 items-center justify-center rounded-field border bg-white disabled:opacity-60 ${on ? "border-navy ring-2 ring-navy/30" : "border-line"}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={posterIconUri(icon, INK)} alt="" width={26} height={26} />
          </button>
        );
      })}
    </div>
  );
}
