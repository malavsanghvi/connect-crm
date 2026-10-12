// Small ornaments the flyer layouts are made from (pure SVG, drawn in code, no text): a divider, a leaf sprig, a banner for a
// title. Generic and geometric on purpose: no religious figure or symbol (the occasion packs carry any tradition's art, with the
// review list in the B96 PR). Colours come from the poster's palette (flyer-art-packs.ts), so a community's brand carries through.

const n = (v: number) => Math.round(v * 100) / 100;

function doc(w: number, h: number, body: string, defs = ""): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${n(w)}" height="${n(h)}" viewBox="0 0 ${n(w)} ${n(h)}">${defs ? `<defs>${defs}</defs>` : ""}${body}</svg>`;
}

/** A hairline with a diamond in the middle and a dot at each end: the divider between a greeting and what follows. */
export function dividerSvg(w: number, h: number, color: string): string {
  const cy = h / 2;
  const d = Math.min(h * 0.46, 9);
  return doc(
    w,
    h,
    `<path d="M${n(h * 0.5 + 4)} ${n(cy)}H${n(w / 2 - d * 2.2)}M${n(w / 2 + d * 2.2)} ${n(cy)}H${n(w - h * 0.5 - 4)}" stroke="${color}" stroke-width="1.6" stroke-linecap="round"/>` +
      `<path d="M${n(w / 2)} ${n(cy - d)}L${n(w / 2 + d)} ${n(cy)}L${n(w / 2)} ${n(cy + d)}L${n(w / 2 - d)} ${n(cy)}Z" fill="${color}"/>` +
      `<circle cx="${n(w / 2 - d * 1.7)}" cy="${n(cy)}" r="${n(d * 0.28)}" fill="${color}"/><circle cx="${n(w / 2 + d * 1.7)}" cy="${n(cy)}" r="${n(d * 0.28)}" fill="${color}"/>` +
      `<circle cx="${n(h * 0.3)}" cy="${n(cy)}" r="${n(h * 0.14)}" fill="${color}"/><circle cx="${n(w - h * 0.3)}" cy="${n(cy)}" r="${n(h * 0.14)}" fill="${color}"/>`,
  );
}

/** A small curl with two leaves (pointing right; `flip` mirrors it): beside an eyebrow word or a label. */
export function sprigSvg(w: number, h: number, color: string, flip = false): string {
  const cy = h / 2;
  const body =
    `<path d="M2 ${n(cy)}Q${n(w * 0.35)} ${n(cy + h * 0.12)} ${n(w * 0.62)} ${n(cy)}T${n(w - 3)} ${n(cy - h * 0.05)}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"/>` +
    `<path d="M${n(w * 0.3)} ${n(cy + h * 0.06)}Q${n(w * 0.34)} ${n(cy - h * 0.42)} ${n(w * 0.5)} ${n(cy - h * 0.46)}Q${n(w * 0.52)} ${n(cy - h * 0.1)} ${n(w * 0.3)} ${n(cy + h * 0.06)}Z" fill="${color}"/>` +
    `<path d="M${n(w * 0.52)} ${n(cy + h * 0.02)}Q${n(w * 0.58)} ${n(cy + h * 0.46)} ${n(w * 0.76)} ${n(cy + h * 0.44)}Q${n(w * 0.76)} ${n(cy + h * 0.1)} ${n(w * 0.52)} ${n(cy + h * 0.02)}Z" fill="${color}"/>` +
    `<circle cx="${n(w - 3)}" cy="${n(cy - h * 0.05)}" r="3" fill="${color}"/>`;
  return doc(w, h, flip ? `<g transform="translate(${n(w)} 0) scale(-1 1)">${body}</g>` : body);
}

/**
 * A title banner: the fill's gradient with concave corners (like a printed cartouche), a gold line inside it and a diamond at
 * each end. `light` and `dark` are the two ends of the gradient (top and bottom).
 */
export function bannerSvg(o: { w: number; h: number; light: string; dark: string; gold: string }): string {
  const { w, h } = o;
  const c = h * 0.3;
  const path = (inset: number) => {
    const i = inset;
    const cc = c - i * 0.4;
    return `M${n(cc + i)} ${n(i)}H${n(w - cc - i)}Q${n(w - cc - i)} ${n(cc + i)} ${n(w - i)} ${n(cc + i)}V${n(h - cc - i)}Q${n(w - cc - i)} ${n(h - cc - i)} ${n(w - cc - i)} ${n(h - i)}H${n(cc + i)}Q${n(cc + i)} ${n(h - cc - i)} ${n(i)} ${n(h - cc - i)}V${n(cc + i)}Q${n(cc + i)} ${n(cc + i)} ${n(cc + i)} ${n(i)}Z`;
  };
  const d = h * 0.07;
  return doc(
    w,
    h,
    `<path d="${path(2)}" fill="url(#bn)"/>` +
      `<path d="${path(2)}" fill="none" stroke="${o.gold}" stroke-width="3"/>` +
      `<path d="${path(h * 0.1)}" fill="none" stroke="${o.gold}" stroke-width="1.4" stroke-opacity="0.85"/>` +
      `<path d="M${n(h * 0.2 - d)} ${n(h / 2)}L${n(h * 0.2)} ${n(h / 2 - d)}L${n(h * 0.2 + d)} ${n(h / 2)}L${n(h * 0.2)} ${n(h / 2 + d)}Z" fill="${o.gold}"/>` +
      `<path d="M${n(w - h * 0.2 - d)} ${n(h / 2)}L${n(w - h * 0.2)} ${n(h / 2 - d)}L${n(w - h * 0.2 + d)} ${n(h / 2)}L${n(w - h * 0.2)} ${n(h / 2 + d)}Z" fill="${o.gold}"/>`,
    `<linearGradient id="bn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${o.light}"/><stop offset="1" stop-color="${o.dark}"/></linearGradient>`,
  );
}

/**
 * An arched window: a panel whose top is a pointed (ogee) arch, with a gold line round it, a second thinner one inside and a soft
 * shadow. `rise` is how far down the arch runs before its sides go straight. The words are set on `fill` (the paper).
 */
export function windowSvg(o: { w: number; h: number; rise: number; fill: string; gold: string; shadow: string }): string {
  const { w, h } = o;
  const r = Math.min(o.rise, h * 0.45);
  const path = (inset: number, dy = 0) => {
    const x0 = inset;
    const x1 = w - inset;
    const top = inset + dy;
    const bottom = h - 8 - inset + dy;
    const cx = w / 2;
    // From the foot up the straight side to the shoulder, an ogee curve to the apex, and down the other side.
    return `M${n(x0)} ${n(bottom)}V${n(top + r)}C${n(x0)} ${n(top + r * 0.55)} ${n(cx - (cx - x0) * 0.62)} ${n(top + r * 0.42)} ${n(cx - (cx - x0) * 0.26)} ${n(top + r * 0.2)}C${n(cx - 8)} ${n(top + r * 0.06)} ${n(cx)} ${n(top)} ${n(cx)} ${n(top)}C${n(cx)} ${n(top)} ${n(cx + 8)} ${n(top + r * 0.06)} ${n(cx + (cx - x0) * 0.26)} ${n(top + r * 0.2)}C${n(cx + (cx - x0) * 0.62)} ${n(top + r * 0.42)} ${n(x1)} ${n(top + r * 0.55)} ${n(x1)} ${n(top + r)}V${n(bottom)}Z`;
  };
  return doc(
    w,
    h,
    `<path d="${path(6, 6)}" fill="${o.shadow}" fill-opacity="0.12"/>` +
      `<path d="${path(6)}" fill="${o.fill}" stroke="${o.gold}" stroke-width="5"/>` +
      `<path d="${path(18)}" fill="none" stroke="${o.gold}" stroke-width="1.6" stroke-opacity="0.85"/>`,
  );
}
