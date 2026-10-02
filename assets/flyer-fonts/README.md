# Flyer fonts

The flyer maker (`src/lib/events/flyer-render.tsx`) draws text with `next/og`
(satori), which reads TTF, OTF or WOFF only — not the WOFF2 files `next/font`
serves to browsers. These four static WOFF files are the brand-kit defaults
(Fraunces for headings, DM Sans for body text), vendored so a flyer never
depends on the network for the default fonts.

| File | Family | Weight | Source |
|---|---|---|---|
| `DMSans-400.woff` | DM Sans | 400 | `@fontsource/dm-sans@5.3.0` · `files/dm-sans-latin-400-normal.woff` |
| `DMSans-700.woff` | DM Sans | 700 | `@fontsource/dm-sans@5.3.0` · `files/dm-sans-latin-700-normal.woff` |
| `Fraunces-600.woff` | Fraunces | 600 | `@fontsource/fraunces@5.3.0` · `files/fraunces-latin-600-normal.woff` |
| `Fraunces-700.woff` | Fraunces | 700 | `@fontsource/fraunces@5.3.0` · `files/fraunces-latin-700-normal.woff` |

- Fetched with `npm pack` on 2026-10-01 and copied unchanged. There is no
  runtime dependency on the fontsource packages.
- Subset: Latin (U+0000–00FF, U+2000–206F punctuation such as – · …, and a few
  more). Gujarati text is drawn with Noto Sans Gujarati, loaded from Google
  Fonts (free, OFL) at render time by `src/lib/events/flyer-fonts.ts`;
  Devanagari (Hindi) is loaded by `next/og` itself. A brand font other than
  Fraunces or DM Sans is loaded from Google Fonts the same way, with these
  files as the fallback.
- Licence: SIL Open Font License 1.1 — see `OFL.txt` (both copyright notices
  and the full licence text). The OFL allows bundling and embedding the fonts
  in images; the fonts themselves are never sold on their own.
- The files reach the standalone server through `outputFileTracingIncludes`
  in `next.config.ts`. A missing file gives the organizer the plain error
  "The flyer fonts are missing on this server."
