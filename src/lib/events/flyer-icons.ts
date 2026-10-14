// The Poster's icon library (pure): line icons drawn in code for the agenda
// rows, the highlight box, the date ribbon and the layouts' blocks (a note, the
// contacts, a date cell). One 48 × 48 grid, round caps, one stroke weight, so
// they read as one family. No text, ever, and no religious figure or symbol.

export type PosterIcon =
  | "clock"
  | "dinner"
  | "dancers"
  | "puja"
  | "lecture"
  | "music"
  | "kids"
  | "prayer"
  | "flag"
  | "people"
  | "star"
  | "calendar"
  | "pin"
  | "food"
  | "phone"
  | "mail"
  | "globe"
  | "heart"
  | "leaf"
  | "ticket"
  | "book";

/** What an organizer picks from (agenda rows and the highlight box), in this order. */
export const POSTER_ICONS: readonly PosterIcon[] = ["clock", "calendar", "pin", "dinner", "food", "people", "kids", "phone", "mail", "globe", "heart", "leaf", "star", "ticket", "book", "music", "lecture", "flag", "dancers", "puja", "prayer"];
export const POSTER_ICON_LABEL: Record<PosterIcon, string> = {
  clock: "Clock",
  dinner: "Dinner",
  dancers: "Dancers (garba)",
  puja: "Puja (diya)",
  lecture: "Lecture",
  music: "Music",
  kids: "Kids",
  prayer: "Prayer",
  flag: "Flag",
  people: "People",
  star: "Star",
  calendar: "Calendar",
  pin: "Place",
  food: "Food",
  phone: "Phone",
  mail: "Email",
  globe: "Website",
  heart: "Heart",
  leaf: "Leaf",
  ticket: "Ticket",
  book: "Book",
};

export function isPosterIcon(v: unknown): v is PosterIcon {
  return typeof v === "string" && (POSTER_ICONS as readonly string[]).includes(v);
}

const PATHS: Record<PosterIcon, string> = {
  people: `<circle cx="24" cy="14" r="6.5"/><path d="M12 40c0-8 5.4-13 12-13s12 5 12 13"/><circle cx="10.5" cy="19" r="4.5"/><path d="M2 37c0-5.6 3.8-9.5 8.5-9.5 2.2 0 4 .7 5.6 2"/><circle cx="37.5" cy="19" r="4.5"/><path d="M46 37c0-5.6-3.8-9.5-8.5-9.5-2.2 0-4 .7-5.6 2"/>`,
  calendar: `<rect x="6" y="10" width="36" height="32" rx="4"/><path d="M6 19h36M16 5v9M32 5v9"/><path d="M13 26h4M22 26h4M31 26h4M13 34h4M22 34h4"/>`,
  pin: `<path d="M24 45s-14-14-14-24.5a14 14 0 0 1 28 0C38 31 24 45 24 45z"/><circle cx="24" cy="20.5" r="5"/>`,
  clock: `<circle cx="24" cy="24" r="18"/><path d="M24 13v11l7.5 4.5"/>`,
  dinner: `<path d="M13 5v11M18 5v11M23 5v11M13 16a5 5 0 0 0 10 0M18 21v22"/><path d="M36 43V5c-5.5 4-7 11-7 18h7"/>`,
  dancers: `<circle cx="13" cy="8" r="3.4"/><path d="M13 12l1 10M14 22l-7.5 14q7.5 3 15 0L14 22"/><path d="M13.4 15l7-4.5M20.4 10.5l3-6M13.4 15l-6 3.5M7.4 18.5l-3-5.5"/><circle cx="35" cy="8" r="3.4"/><path d="M35 12l-1 10M34 22l7.5 14q-7.5 3-15 0L34 22"/><path d="M34.6 15l-7-4.5M27.6 10.5l-3-6M34.6 15l6 3.5M40.6 18.5l3-5.5"/><path d="M10 42h28" stroke-dasharray="1 4"/>`,
  puja: `<path d="M24 6c4.6 5.4 5.4 10 0 14.5C18.6 16 19.4 11.4 24 6z"/><path d="M24 20.5v3"/><path d="M8 27h32c-1.6 7.2-7.8 11-16 11S9.6 34.2 8 27z"/><path d="M16 43h16M24 38v5"/>`,
  lecture: `<path d="M9 21h30l-3 6H12z"/><path d="M15 27l3 16h12l3-16"/><path d="M16 43h16"/><path d="M27 21l6-11"/><circle cx="34.5" cy="7.5" r="3"/>`,
  music: `<circle cx="14" cy="36" r="5"/><circle cx="35" cy="32" r="5"/><path d="M19 36V11l21-4v25"/><path d="M19 17l21-4"/>`,
  kids: `<circle cx="16" cy="10" r="4.8"/><path d="M16 15v13M8 21h16M16 28l-5.5 13M16 28l5.5 13"/><circle cx="34" cy="19" r="3.8"/><path d="M34 23v9M28.5 27h11M34 32l-4.2 9M34 32l4.2 9"/>`,
  prayer: `<path d="M24 6c-3 3.5-6 9-6 15.5L11.5 31a3 3 0 0 0 .4 3.7L18 41h6z"/><path d="M24 6c3 3.5 6 9 6 15.5L36.5 31a3 3 0 0 1-.4 3.7L30 41h-6z"/><path d="M15 44l4-3M33 44l-4-3"/>`,
  flag: `<path d="M12 5v39M7 44h10"/><path d="M12 8c6-3 11 3 17 1s6-3 9-4v16c-3 1-4 3-9 4s-11-4-17-1z"/>`,
  star: `<path d="M24 5l5.6 11.6 12.8 1.8-9.3 9 2.2 12.6L24 34l-11.3 6 2.2-12.6-9.3-9 12.8-1.8z"/>`,
  food: `<path d="M6 24h36c0 10-7 17-18 17S6 34 6 24z"/><path d="M16 45h16"/><path d="M16 7c-2.6 3 2.6 5 0 9M24 5c-2.6 3 2.6 5 0 9M32 7c-2.6 3 2.6 5 0 9"/>`,
  phone: `<rect x="13" y="4" width="22" height="40" rx="5"/><path d="M13 10h22M13 36h22"/><path d="M21.5 40h5"/>`,
  mail: `<rect x="4" y="9" width="40" height="30" rx="4"/><path d="M5.5 12.5L24 28l18.5-15.5"/>`,
  globe: `<circle cx="24" cy="24" r="19"/><ellipse cx="24" cy="24" rx="8" ry="19"/><path d="M5 24h38M8 14h32M8 34h32"/>`,
  heart: `<path d="M24 41C10 31 5 23 5 15.5 5 10 9 6.5 13.8 6.5c4 0 7.4 2.4 10.2 6.7 2.8-4.3 6.2-6.7 10.2-6.7C39 6.5 43 10 43 15.5 43 23 38 31 24 41z"/>`,
  leaf: `<path d="M24 43V24"/><path d="M24 28C13 28 7 21.5 7 10c11 0 17 5.5 17 18z"/><path d="M24 33c0-8 5.5-13.5 17-13.5C41 31 35 37 24 33z"/>`,
  ticket: `<path d="M4 13h40v8.2a3.4 3.4 0 0 0 0 6.6V36H4v-8.2a3.4 3.4 0 0 0 0-6.6z"/><path d="M31 14v4M31 22v4M31 30v4"/><path d="M12 20h12M12 28h8"/>`,
  book: `<path d="M24 11c-5-4-12-5-19-3.5v29C12 35 19 36 24 40c5-4 12-5 19-3.5v-29C36 6 29 7 24 11z"/><path d="M24 11v29"/>`,
};

/** One icon as a complete SVG document, stroked in `color`. */
export function posterIconSvg(name: PosterIcon, color: string, strokeWidth = 2.6): string {
  const body = PATHS[name];
  const c = /^#[0-9a-f]{6}$/i.test(color) ? color : "#2B2A8A";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="${c}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

/** The same icon as a data URI, for an <img> (the SVG is ASCII, so btoa works in the browser and on the server). */
export function posterIconUri(name: PosterIcon, color: string, strokeWidth = 2.6): string {
  return `data:image/svg+xml;base64,${btoa(posterIconSvg(name, color, strokeWidth))}`;
}
