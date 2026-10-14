# Flyer fonts

The flyer maker (`src/lib/events/flyer-render.tsx`) draws text with `next/og`
(satori), which reads TTF, OTF or WOFF only — not the WOFF2 files `next/font`
serves to browsers. These static WOFF files are the flyer maker's bundled faces,
vendored so a flyer never depends on the network for them. The defaults are the
Weaver brand kit's two faces (Bricolage Grotesque for headings, Hanken Grotesk for
body text, since 2026-10-14); Fraunces and DM Sans, the previous defaults, stay for a
community whose brand names them, and Kaushan Script is the layouts' accent.

| File | Family | Weight | Source |
|---|---|---|---|
| `BricolageGrotesque-600.woff` | Bricolage Grotesque | 600 | `@fontsource/bricolage-grotesque@5.3.0` · `files/bricolage-grotesque-latin-600-normal.woff` |
| `BricolageGrotesque-700.woff` | Bricolage Grotesque | 700 | `@fontsource/bricolage-grotesque@5.3.0` · `files/bricolage-grotesque-latin-700-normal.woff` |
| `BricolageGrotesque-800.woff` | Bricolage Grotesque | 800 | `@fontsource/bricolage-grotesque@5.3.0` · `files/bricolage-grotesque-latin-800-normal.woff` |
| `HankenGrotesk-400.woff` | Hanken Grotesk | 400 | `@fontsource/hanken-grotesk@5.3.0` · `files/hanken-grotesk-latin-400-normal.woff` |
| `HankenGrotesk-500.woff` | Hanken Grotesk | 500 | `@fontsource/hanken-grotesk@5.3.0` · `files/hanken-grotesk-latin-500-normal.woff` |
| `HankenGrotesk-700.woff` | Hanken Grotesk | 700 | `@fontsource/hanken-grotesk@5.3.0` · `files/hanken-grotesk-latin-700-normal.woff` |
| `HankenGrotesk-800.woff` | Hanken Grotesk | 800 | `@fontsource/hanken-grotesk@5.3.0` · `files/hanken-grotesk-latin-800-normal.woff` |
| `DMSans-400.woff` | DM Sans | 400 | `@fontsource/dm-sans@5.3.0` · `files/dm-sans-latin-400-normal.woff` |
| `DMSans-500.woff` | DM Sans | 500 | `@fontsource/dm-sans@5.3.0` · `files/dm-sans-latin-500-normal.woff` |
| `DMSans-700.woff` | DM Sans | 700 | `@fontsource/dm-sans@5.3.0` · `files/dm-sans-latin-700-normal.woff` |
| `DMSans-800.woff` | DM Sans | 800 | `@fontsource/dm-sans@5.3.0` · `files/dm-sans-latin-800-normal.woff` |
| `Fraunces-600.woff` | Fraunces | 600 | `@fontsource/fraunces@5.3.0` · `files/fraunces-latin-600-normal.woff` |
| `Fraunces-700.woff` | Fraunces | 700 | `@fontsource/fraunces@5.3.0` · `files/fraunces-latin-700-normal.woff` |
| `Fraunces-800.woff` | Fraunces | 800 | `@fontsource/fraunces@5.3.0` · `files/fraunces-latin-800-normal.woff` |
| `Fraunces-900.woff` | Fraunces | 900 | `@fontsource/fraunces@5.3.0` · `files/fraunces-latin-900-normal.woff` |
| `KaushanScript-400.woff` | Kaushan Script | 400 | `@fontsource/kaushan-script@5.3.0` · `files/kaushan-script-latin-400-normal.woff` |

- Bricolage Grotesque and Hanken Grotesk (2026-10-14) were fetched with `npm pack` and copied unchanged, as below. The static files are the
  default optical size of Bricolage Grotesque (the website uses its optical-size axis; satori reads static fonts only), and Bricolage stops at weight
  800: a 900 request (the Poster's heaviest) is drawn in its 800. `tests/events-flyer-fonts.test.ts` keeps the defaults, the files and the licence in step.
- Kaushan Script (2026-10-12) is the brush-script accent of the flyer layouts (flyer-layout.ts): one accent word of a title, a "Save the date" line, a greeting. It is only read when a flyer uses a layout, and never for Gujarati or Devanagari words (those use the display font).
- Fetched with `npm pack` on 2026-10-01 (the 500, 800 and 900 weights, for the
  Poster template, on 2026-10-02) and copied unchanged. There is no
  runtime dependency on the fontsource packages.
- Subset: Latin (U+0000–00FF, U+2000–206F punctuation such as – · …, and a few
  more). Gujarati text is drawn with Noto Sans Gujarati, loaded from Google
  Fonts (free, OFL) at render time by `src/lib/events/flyer-fonts.ts`;
  Devanagari (Hindi) is loaded by `next/og` itself. A brand font that is not one of
  the bundled families (Bricolage Grotesque, Hanken Grotesk, Fraunces, DM Sans) is loaded from Google Fonts the same way, with
  Bricolage Grotesque and Hanken Grotesk as the fallback.
- Licence: SIL Open Font License 1.1 — see `OFL.txt` (both copyright notices
  and the full licence text). The OFL allows bundling and embedding the fonts
  in images; the fonts themselves are never sold on their own.
- The files reach the standalone server through `outputFileTracingIncludes`
  in `next.config.ts`. A missing file gives the organizer the plain error
  "The flyer fonts are missing on this server."
