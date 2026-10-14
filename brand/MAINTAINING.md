# Keeping the brand kit current

`brand/` is the Weaver brand kit: the brand book (`README.md`), the design tokens (`tokens.json`, and the same values as CSS
variables in `weaver-tokens.css`), the logo files, the 42 icons and the guides for the logo, button, AI tag and controls. It is
the reference every Weaver surface follows: the public website, the staff portal, the member app and the event-day app.
`docs/BRAND_CONFORMANCE.md` is the audit of `connect-crm` against it and lists what still waits for an owner decision.

## How the tokens flow

`brand/tokens.json` is the one source of the colours, the three faces (Bricolage Grotesque, Hanken Grotesk, and JetBrains Mono for
identifiers), the radii, shadows, layout and control sizes; `brand/icons/*.svg` are the one source of the icons.

- **The portal and the website (this repository).** `node scripts/sync-brand-tokens.mjs` writes `src/styles/brand-tokens.css` from
  `tokens.json` (a Tailwind `@theme static` block plus the layout sizes on `:root`) and `src/lib/brand-tokens.generated.ts` (the
  colours and shadows as typed constants). It also rewrites `brand/weaver-tokens.css` (the kit's own preview stylesheet) and
  `src/components/brand/icons.generated.ts` (the markup of every file in `brand/icons`, for the `Icon` component). `src/app/globals.css` imports it, so the portal
  in both looks and the website read the same variables and utilities: `bg-navy`, `text-brown`, `rounded-card`, `shadow-hero`,
  `font-display`, `var(--color-line)`. The portal's own additions (aliases, shades worked out from kit colours, the three module hues
  the kit has no colour for) are in `src/styles/portal-tokens.css`. The faces are loaded once, in `src/app/layout.tsx`, with
  `next/font`; the generated file puts the variables it sets (`--font-bricolage`, `--font-hanken`) in front of the kit's own stacks.
  Never edit `brand-tokens.css` by hand.
- **Code that cannot read a CSS variable** (the share image, the home-screen icon, hand-written HTML pages, the brand page's swatches)
  uses `brandColor("navy")` and `brandShadow("shadow-hero")` from `src/lib/brand-colors.ts`, which read the generated constants. Email
  and the pledge PDF are shared with the background service and cannot import it, so they hold the kit's values written out
  (`EMAIL_PALETTE` in `src/lib/messaging/email.ts`, the two defaults in `src/lib/pledge-pdf/document.ts`); the conformance test checks them.
- **The member app (`connect-mobile`) and the event-day app (`connect-admin`).** Each keeps a verbatim copy of `brand/tokens.json` (and of `brand/icons/` if it draws them) and
  builds its own theme from it. When `tokens.json` changes, copy the file to both repositories in the same step as
  `src/lib/database.types.ts` is copied after a migration: same change, same day, one pull request each, and a note in the pull
  request that says which kit version it carries. Do not edit the copies.

## Changing a token

1. Edit `brand/tokens.json` (value, usage, and add the row to the right group). Bump `version` and `meta.synced`.
2. Run `node scripts/sync-brand-tokens.mjs`. Commit the four regenerated files (`src/styles/brand-tokens.css`,
   `src/lib/brand-tokens.generated.ts`, `brand/weaver-tokens.css`, `src/components/brand/icons.generated.ts`).
3. Update `brand/README.md` (and a guide under `components/`) when the rule changes, and the Brand page if it shows the token
   (`src/app/site/brand/page.tsx` reads its swatches from `tokens.json`).
4. Run `npx vitest run tests/brand-conformance.test.ts tests/look-tokens.test.ts`. The second one checks that every text and surface
   pair the portal uses is still at least 4.5:1.
5. Copy `tokens.json` to `connect-mobile` and `connect-admin`.

## The conformance test

`tests/brand-conformance.test.ts` runs with the rest of the suite (`pnpm test`). It fails when:

- a colour value (hex, `rgb()`, `rgba()`, `hsl()`, a Tailwind arbitrary colour) appears in `src/` that is not one of the kit's own
  values, outside the allowlist at the top of the test (each line there says why: the generated token file, the logo's own drawing,
  event flyer artwork and a community's own palettes, the portal's three module hues); or a Tailwind default-palette class
  (`bg-red-500`) or a logo-only colour (`bg-mark-teal`) is used in the interface;
- a generated file (`src/styles/brand-tokens.css`, `src/lib/brand-tokens.generated.ts`, `brand/weaver-tokens.css`,
  `src/components/brand/icons.generated.ts`) is not what the kit produces (run the script), or an icon file lacks the kit's root;
- the root layout loads a face the kit does not name;
- "Community Connect" appears in a string a person reads (the allowlist names the few places it is kept on purpose);
- a logo file is missing from `brand/logos` or `public/brand`, the favicon, the app icon and `brand/logos/weaver-mark.svg` are not
  one drawing, or the mark is drawn a second time;
- the public pages say "bid", an emoji, an exclamation mark, "AI Native", "end-to-end encrypted" or an undated "coming soon", or the
  kit's lines in `README.md` are not used word for word.

When it reports a finding, fix the finding. Add to the allowlist only for something that is not Weaver's own look, and write the reason
beside the line.

## The rest of the kit

- **The mark.** `logos/weaver-mark.svg` is a copy of `src/app/icon.svg` (and of `public/brand/weaver-mark.svg`); the test keeps them
  byte-equal. After any change to the mark, copy it to all three and to `src/components/brand/weaver-mark.tsx`, then run
  `node scripts/brand-logo-pngs.mjs` from the repository root: it redraws every PNG in `brand/logos/` and the downloads in
  `public/brand/` (it fetches the two faces from Google Fonts, so it needs the internet).
- **The logo and the AI tag in code.** `src/components/brand/logo.tsx` (`Logo`, `LogoTile`) and `src/components/brand/ai-tag.tsx`
  (`AiTag`) are the implementations of `components/Logo` and `components/AiTag`; the website's buttons are
  `src/components/site/ui.tsx` (`buttonStyles`) and the portal's are `.cc-btn` in `src/app/globals.css`. A change to a guide in
  `components/` is a change to those files in the same pull request.
- **The icons.** `icons/*.svg` are the source, drawn in `navy` on the kit's root element (24px grid, stroke 2, round caps). Add a new
  icon as a file there, run the script, and use it as `<Icon name="..." />` from `src/components/brand/icons.tsx`: the website and the
  portal share that one component, and the test fails on an inline `<svg>` icon drawn instead.
- **The words.** The lines in the brand book's Voice section are the owner's, word for word. Change them only on the owner's
  say-so, and change the website's copy, the share image (`src/app/site/opengraph-image.tsx`) and `src/lib/site.ts` with them.
- **The previews.** `cover.html` and `components/*/preview.html` open in a browser straight from this folder; they read
  `weaver-tokens.css` and the files in `logos/`.

The same kit is published as a browsable brand book (a private Claude artifact, "Weaver Brand Kit") and as a public page at
www.weaverams.org/brand.
