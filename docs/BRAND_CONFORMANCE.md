# Brand conformance: the portal and the website against the Weaver brand kit

Owner request, 2026-10-14: "Make sure all pages of the platform (admin / website / mobile app) etc use the same brand kit: colors / fonts / images / styling... everything."

The source of truth is the kit in `brand/` (`README.md`, `tokens.json`, `logos/`, `icons/`, `components/`) and the public Brand page that publishes it (`src/app/site/brand`). Where this repository's other docs disagree with `brand/tokens.json`, the kit wins. This file is the audit of `connect-crm` (the admin portal, the public website, and the portal's public pages `/login`, `/request-access`, `/start`, `/demo`, `/c/<slug>`), what was brought onto the kit in the same pull request, and what waits for the owner. The member app and the event-day app are audited in their own repositories.

A community's own name, logo and colours (`centers.branding`) are the community's identity and are not replaced by Weaver's. Weaver's own chrome (the product name, the mark, buttons, type and the colours of the platform itself) follows the kit.

## What changed in one paragraph

Before, the repository carried three palettes: the portal's "classic" look (the old Jain prototype: navy `#1B2C5C`, saffron `#C9731C`, warm paper `#F6F2EA`, Fraunces and DM Sans), the portal's "New look" (a cool blue palette of its own, `#1C56B0` and `#F3F7FB`, written up in `docs/ADMIN_REDESIGN.md`), and the website (the kit's palette, re-pointed by hand inside `.site-root`). Now `brand/tokens.json` is the one source: `scripts/sync-brand-tokens.mjs` writes `src/styles/brand-tokens.css` (committed; a test fails when it is out of date), `src/app/globals.css` imports it, and the portal in both looks and the website read the same variables, utilities (`bg-navy`, `rounded-card`, `shadow-hero`, `font-display`) and faces (Bricolage Grotesque and Hanken Grotesk, loaded once in `src/app/layout.tsx`). Code that cannot read a CSS variable (the share image, the home-screen icon, hand-written HTML pages) reads the same values through `src/lib/brand-colors.ts`, which uses a second generated file, `src/lib/brand-tokens.generated.ts` (typed colour and shadow names, no prose, nothing from the JSON in a client bundle). The portal's own additions are a small file, `src/styles/portal-tokens.css`: aliases, shades worked out from kit colours, and the three module hues the kit has no colour for (decision D4).

## How the tokens flow

```
brand/tokens.json  ──  scripts/sync-brand-tokens.mjs  ──►  src/styles/brand-tokens.css  ──►  src/app/globals.css (@import)
   (the source)                                              (generated, committed)            ├─ the portal, classic look
        │                                                                                      ├─ the portal, "New look" (--v2-* names, aliases of the same tokens)
        │                                                                                      └─ the website (src/app/site, src/components/site)
        ├──►  src/lib/brand-tokens.generated.ts  ──►  src/lib/brand-colors.ts  ──►  share image, apple icon, 404 page, plain HTML pages, brand page swatches
        ├──►  brand/weaver-tokens.css  (the kit's own preview stylesheet; the test keeps its colours equal)
        └──►  a verbatim copy in connect-mobile and connect-admin (copied like src/lib/database.types.ts; see brand/MAINTAINING.md)
```

`tests/brand-conformance.test.ts` is the guard; `tests/look-tokens.test.ts` checks contrast (WCAG AA, 4.5:1) of the portal's text and surface pairs against the kit's own values. How to run both is in `brand/MAINTAINING.md`.

## Counts

| What | Before | After |
|---|---|---|
| Colour values written in `src/` (comments left out): hex, rgb(a), Tailwind arbitrary colours | 1,412 in 104 files | 1,101 in 43 files |
| ...that were neither a kit colour nor in a file the guard allows (drift) | 273 in 67 files | 0 |
| ...that equal a kit colour (allowed anywhere) | 109 | 27 |
| ...in files the guard allows, with a reason (flyer artwork, the generated token file, the logo's own drawing, tenant palettes) | 1,030 | 1,074 |
| Arbitrary Tailwind colour classes (`bg-[#...]`, `text-[#...]`, `border-[#...]`) | 115 | 0 |
| Arbitrary shadows and scrims with an rgba value | 31 | 0 |
| `text-saffron` (the kit: saffron is never text) | 28 | 0 (now `text-brown`) |
| `font-extrabold` and `font-weight: 800` (the kit's type tops out at 700) | 58 | 0 |
| Product-name drift in a string a person reads ("Community Connect", "CommunityConnect", "Connect approves") | 14 | 6, each allowlisted in the test with its reason |
| Places a hard-coded radius still stands in the portal (`rounded-[Npx]`) | 508 | 507 (decision D10) |

## (a) Colours

| Item | The kit says | The surface did | Status |
|---|---|---|---|
| Portal, classic look: the whole `@theme` | Indigo `navy #2b2a8a`, `saffron #ff7640`, `canvas #fffaf5`, `ink #1e1d5c`, `muted #555a79` ... | Old Jain prototype palette (navy `#1b2c5c`, saffron `#c9731c`, canvas `#f6f2ea`, ink `#1e1c18`) | Fixed: the generated kit tokens replace it |
| Portal, "New look" (`[data-look="v2"]`) | Same tokens | A second palette of its own (blue `#1c56b0`, page `#f3f7fb`, ink `#12203a`) that also re-pointed the portal's token names | Fixed: its 32 `--v2-*` names stay (about 400 uses) and now point at kit tokens; the two looks differ in layout, not colour. `tests/look-tokens.test.ts` rewritten against the kit |
| Website theme | Same tokens | `.site-root` re-pointed 21 tokens by hand, matching the kit today | Fixed: the website reads the global tokens; `site.css` keeps only the face |
| Hard-coded colours in components | A token | Of the 273 off-kit values: 90 in `globals.css` and 183 in components and libraries (the public dashboard 26, the Giving ask flow 10, emails 9, the check-in screen 7, bar colours 7). That includes 115 arbitrary colour classes, 31 arbitrary shadows or scrims, and the error-box pair `#7a1a14` and `#f0b9b4` written 41 times, cool tints `#eaf0f7`, an amber `#fff4d6`, a blue `#16306b` | Fixed: error boxes are `border-danger/30 bg-danger-50 text-danger`, tints are `navy-50`, `saffron-50`, `track`, scrims are `bg-ink/45`, shadows are the kit's `shadow-menu`, `shadow-window`, `shadow-hero`, `shadow-panel` |
| Saffron as text | "It is never text" (white on saffron 2.6:1; saffron on white below 3:1) | 28 `text-saffron` (nav counts, money, warnings, the Niva glyph, the website's 404) and a navigation count badge of white on saffron | Fixed: `text-brown` (6.2:1 on white); the badge is ink on saffron (5.7:1) |
| Gradients | Only the AI tag, the headline underline, the picture wash | Two progress bars with gradients (the giving panel's sun gradient, the onboarding bar in the logo's `mark-*` colours); the headline underline written as a raw `rgba` gradient | Fixed: progress fills are `navy`; the underline is the class `.site-underline` built from `gold` and `saffron` |
| Gradient on the Niva button | "Never use it for buttons or backgrounds" | The sun gradient fills the Niva orb in the rail, the Ask button in Giving and the Niva icon | Kept, decision D1 (an existing, tested design choice: `tests/look-tokens.test.ts` pins "the sun gradient is Niva's button only") |
| `mark-*` colours in the interface | "The mark colours belong to the logo only" | Only in the onboarding progress bar | Fixed (above); the guard now fails on any `bg-mark-*` class |
| Warning and info states | The kit has `success` and `danger` only | The portal's warning is amber (`#8a4608`, `#fff4d6`), its info a cool blue | Fixed to kit tints (warning: `saffron-50`, `saffron-200`, `brown-900`, the AI line's own pair; info: `navy-50`); decision D5 asks for a `warning` token |
| Third grey (`faint`) | One supporting grey, `muted` (6:1 on every surface) | `faint` `#8a8478` (3.7:1 on white: placeholders, disabled text, 77 uses) | Fixed: `--color-faint` is an alias of `muted`; decision D5 |
| Module hues | Not in the kit | Events maroon, Pathshala and content purple, store green; 31 uses; the website's mockup pills reuse purple and maroon | Kept, decision D4 (the only hex values in the portal's token file) |
| Public dashboard `/c/<slug>` | Kit tokens | A second warm palette (`#e8e0d2` borders, `#f6efe3`, `#e8892a` button with white text) | Fixed: `line`, `track`, the kit's tint pairs, and the gold button on the navy band (`gold` with `navy` text) |
| Event-day check-in screen in this repository (`src/app/ops`) | Kit tokens | Seven amber and pastel hex values | Fixed: `gold`, `navy-100`, `success-200`, `danger-200` (shades of kit colours) |
| Bar and progress colours (`bar-list.tsx`) | Kit tokens | Eight hex values | Fixed: they read `var(--color-...)`; the module hues stay as in D4 |
| Browser theme colour (`viewport.themeColor`) | `navy` | `#1B2C5C` | Fixed: `brandColor("navy")` |
| Share image (`opengraph-image.tsx`) | The hero: saffron band, white card, the promise in Bricolage | Old canvas `#F6F2EA` and navy, no real faces, and the text "AI Native Community Weaver Platform. Paid Forward Already." | Fixed: see (c) and (e) |
| Apple touch icon | The mark on `white` | Mark on `#ffffff` | Kept as drawn; the colour now comes from the kit (`brandColor("white")`) |
| Emails (`src/lib/messaging/email.ts`) | Kit tokens | A fourth set (`#7a3e12` fallback brand colour, `#f6f3ee`, `#1f1a14`, `#6f6556`) and a banner of amber | Fixed: `EMAIL_PALETTE` holds the kit's canvas, ink, muted, line, navy, `saffron-50`, `saffron-200`, `brown-900`; a community's own colour still wins for its header rule and name |
| Pledge PDF defaults | Kit tokens | Old navy `#1B2C5C` and saffron `#C9731C` as the platform colours, and grey-brown inks | Fixed: defaults are the kit's `navy` and `brown`; the inks are the kit's `ink`, `muted`, `line`. The test that pinned the old default was updated |
| Raw HTML pages (unsubscribe, payment return, the website's 404) | Kit canvas, ink, face | `#1f1a14`, `#1f2937`, `#F6F2EA`, `#C9731C` | Fixed through `src/lib/brand-html.ts` |
| Calendar layer default, example hex codes in messages (`#1B2C5C`, `#1B5E9C`), import sample | Kit values | Old values | Fixed: `#2B2A8A`, `#A8400D` |
| Colours a community chose | Not Weaver's | `centers.branding` colours in flyers, the website draft, the setup helper; the setup screen's defaults | Kept (allowlisted with a reason). The defaults for a community with no colours of its own are now Weaver's navy and brown (`DEFAULT_COMMUNITY_PALETTE`) in the setup screens and the pledge PDF; the flyer maker's own defaults are decision D7 |
| Dark mode | The kit defines `light` only | `html { color-scheme: light }`; no `prefers-color-scheme` anywhere (tested for the v2 section) | Nothing to fix |
| Window title dots on the website's pictures | "A `ground` title bar with three dots" (no colours named) | Two off-kit dots (`#e5836f`, `#7dbb97`) | Fixed: `saffron`, `gold`, `success` |

## (b) Fonts

| Item | The kit says | The surface did | Status |
|---|---|---|---|
| Portal display and text faces | Bricolage Grotesque (display), Hanken Grotesk (everything else), loaded with the optical-size axis | Fraunces and DM Sans through `next/font` in the root layout | Fixed: the root layout loads Bricolage Grotesque (`opsz` axis) and Hanken Grotesk once for the portal and the website; `--font-display` and `--font-sans` come from the generated tokens; the website's own second loading was removed |
| Fallbacks | `"Hanken Grotesk", ui-sans-serif, system-ui, sans-serif` | Georgia for display, system-ui for text | Fixed: the kit's stacks sit behind the loaded face |
| Identifiers (receipt, pledge and member numbers) | No monospace in the kit | JetBrains Mono, 245 `font-mono` uses, and the Brand page's hex codes | Kept, decision D3 |
| Weights | 400 to 700 | 55 `font-extrabold` and 3 `font-weight: 800` rules | Fixed: 700 |
| Type scale | `hero`, `heading`, `lead`, `body`... for the website | The website follows it (checked by reading, not by a test); the portal has its own denser scale (11 to 28 px) | Portal scale kept: a dense admin tool, not a public page |
| Emails | Hanken Grotesk | `system-ui` | Fixed: Hanken Grotesk first, the system face where an email client does not have it |
| Share image | Both faces | The built-in face of `next/og` | Fixed: `src/lib/brand-og.ts` loads Bricolage Grotesque 600 and 700 and Hanken Grotesk 600 and 700 from Google Fonts (as `src/lib/events/flyer-fonts.ts` does for other families), and draws in the built-in face, logged, if the fetch fails |
| Hand-written HTML pages | Kit face | `system-ui` | Fixed to name the kit's stack; no web font is loaded for them |
| Pledge PDF | Not specified | Built-in Helvetica, on purpose: pdf-lib's standard font, no font file to ship to the background service, and the pledge document is the community's own statement | Kept; noted in the file |
| Flyer maker | A community's own flyer | Bundled Fraunces, DM Sans, Kaushan Script, and the community's chosen faces | Kept, decision D7 |
| Gujarati and Hindi | Neither face has those scripts | The system's fonts, as before | Not changed |

## (c) Logo and images

| Item | The kit says | The surface did | Status |
|---|---|---|---|
| The W mark in the interface | Use the files exactly; never redraw | `WeaverMark` (a vector copy of `src/app/icon.svg`) in the website header and footer, sign-in, request-access and sandbox-start pages, the demo page, both portal shells | In step: `tests/brand.test.ts` keeps `icon.svg` equal to the component; the new test keeps `brand/logos/weaver-mark.svg` and `public/brand/weaver-mark.svg` byte-equal to it and fails on a second drawing of the silhouette |
| The lockup | Mark 44 px, name 24 px, 6 px apart; settings default, onAccent, light | Written inside the website's header and imported by the footer | Fixed: one `Logo` in `src/components/brand/logo.tsx` (used by the header and footer) |
| The mark over navy | On a `white` tile with `radius-logo-tile` (12 px), the mark at about 72% | Sign-in, request-access and demo drew a 16 px-radius tile at 75% | Fixed: `LogoTile` (12 px, 72%) on all three pages and the footer |
| Favicon (`src/app/icon.svg`) | Same mark file | Identical to `brand/logos/weaver-mark.svg` | In step; tested |
| `favicon.ico` | Same mark | The mark on white, one 180 px PNG in an ICO | Kept (valid; a 16/32/48 set is a small follow-up) |
| Apple touch icon | Same mark | `apple-icon.tsx` draws the mark on white with the component | In step |
| Open Graph and Twitter share image | The mark, the kit's lines | One route (`src/app/site/opengraph-image.tsx`) used for both; old palette, "AI Native Community Weaver Platform. Paid Forward Already.", no descriptor | Fixed: the hero drawn from the kit (saffron band, white card, mark, name, descriptor, the promise word for word with "For free. Forever." in `brown` on the gold-to-saffron underline, the generosity line, the three Weavers). Rendered and checked in a browser |
| The portal's own pages | The community's name and logo lead; Weaver small | `TenantMark` first, then the small Weaver mark and name | In step |
| Emails | Header and footer carry the logo | A community's logo, else its name; the mark is not in Weaver's own emails (sign-in codes) | Decision D9 |
| PNG downloads | The kit's seven files | `brand/logos` and `public/brand` hold the same seven | In step; tested |
| Stock or placeholder images | None | None in `public/` or `src/` (only `public/brand/`) | Nothing to fix |
| Pictures of the product | Drawn in HTML and CSS, in a window frame, labelled "Sample data" | `src/components/site/mockups.tsx` draws them in frames titled "Sample Community..." and the footer says "Screens on this site show sample data"; the household picture said "Connect number" | Fixed: "Household no." as the portal says it. The label is carried by the frame title and the footer line; a literal "Sample data" label on each picture is a copy decision for the owner (D11) |
| Brand page swatches | Kit values | Six hex strings typed by hand | Fixed: read from `brand/tokens.json` |

## (d) Styling

| Item | The kit says | The surface did | Status |
|---|---|---|---|
| Buttons, website (`src/components/site/ui.tsx`) | Pills, 52 px (56 in the hero), `button` 16 px; primary, ghost, gold, ghostOnNavy; focus 2 px navy, offset 4 px | Implements all four; gold hover was a literal `#ffc84a` | Fixed: `gold-hover`, a shade of `gold`; the rest was in step |
| Buttons, portal (`.cc-btn`) | The same four styles | Primary matched; ghost was a 1 px solid navy border; radii were pixel values; the focus offset was 2 px; ok, warn and bad variants have no counterpart in the kit | Fixed: pill radius from the token, the ghost is "white, 2 px border of navy at 20%, navy on hover", the focus offset is 4 px on buttons. Heights, see D2; the status variants are D5 |
| Button size and tap target | 52 px or more; anything tapped 48 px | Portal: 52 (`lg`), 40, 36, 30 px; 12 to 13 px labels | Decision D2 |
| Cards | White on canvas, 1 px `line`, `radius-card` (24 px), `card-pad` | Website: in step (now the token classes). Portal: white, 1 px line, 16 px | The portal's 16 px is the kit's `radius-tile` ("small cards"); the card now says so. Padding and density kept (D10) |
| Chips and tags | Pill for chips; `radius-chip` (6 px) for the AI tag | Portal chips: 16 px on 32 px (a pill); status tags 8 px | Chips fixed to the pill token. Status tags kept at 8 px: the kit has no status-tag radius (D10) |
| AI tag and AI line | Gold-to-saffron tag on `saffron-50`, `radius-chip`, white dot | Website: in step, written inside `page.tsx`. Portal: no AI tag; Niva appears as a sparkle glyph and the word "Niva" | Website: one `AiTag` in `src/components/brand/ai-tag.tsx`. Portal: decision D1 |
| Form fields | Border `line-input` | Portal 10 px radius, 42 px high, 2 px navy focus ring; the onboarding pages 12 px | Colour fixed. Radius is not in the kit (D10) |
| Tables | `ground` panels, `line` rules | Canvas header row, `line-soft` rules, `highlight` row | Colours fixed; the highlight is `saffron-50` |
| Toasts, modals, drawers | Not specified | 14, 22 and side-sheet shadows in pixel values | Fixed to kit shapes where the kit has a name: toast `radius-tile`, modal `radius-card`, shadows composed from `ink`, menus `shadow-menu`, modals and sheets `shadow-window` |
| Focus ring | 2 px solid `navy`, offset 2 px (4 px on buttons) | In step | Fixed for buttons |
| Layout tokens | `container 1160`, `gutter`, `section-y`, `card-pad`... | The website uses the numbers as Tailwind arbitrary values (`max-w-[1160px]`) | The tokens are now emitted as `--container` and the rest; replacing the website's numbers with them is cosmetic and was not done |
| Radii | Named tokens | 508 hard-coded `rounded-[Npx]` in the portal; the website's values that equal a token (24, 20, 32, 40 px) are now the token classes (19 places) | Portal: D10 |
| Icons | 21 stroke icons on a 24 px grid, stroke 2, round caps, no fill | The website uses the 21. The portal draws about 44 inline SVGs of its own (every `viewBox` found is 24 by 24), with strokes of 1.6, 1.8, 2, 2.2, 2.4, 2.5, 3 and 3.4 | Three thin ones (1.6 and 1.8, including every workspace icon in the rail) set to 2. The rest: D8 |

## (e) Voice in UI copy

| Item | The kit says | The surface did | Status |
|---|---|---|---|
| Product name | "Weaver", never "Community Connect" or "Connect" | Seven user-facing strings said "Community Connect" (the payments pause, the readiness check, the Stripe notes) and one said "Connect approves your request" (the code-redemption page) | Fixed. Kept on purpose and allowlisted: the QuickBooks marker "Community Connect test post" (migration 0234, `docs/DECISIONS.md`), the audit reason `CC_FIRST_ADMIN_REASON` (migration 0400), and the database's "Community Connect has paused ..." (migrations 0580 and 0597, applied; the code now accepts "Weaver has paused" too). 83 applied migration and test files still say it; a new migration is the way to change them (already noted in `docs/DECISIONS.md`) |
| The module label "CommunityConnect" (WhatsApp Business) | "Weaver" | `src/lib/modules.ts` | Decision D6 |
| The AI line | "AI does the busywork. People make the final decisions." word for word | Paraphrased three times: the home page's hero ("AI does the busywork, and people make the final decisions"), the site description ("...busywork and people make..."), the header menu ("AI does the busywork; people decide") | Fixed; the test fails on any "AI does the busywork" that is not followed by the second sentence |
| The other lines (promise, why it is free, belief, partner promise, leaving, closing, generosity, descriptor) | Word for word | In place on the home page, `src/lib/brand.ts`, `src/lib/site.ts` and the Brand page | In step; tested against `brand/README.md` |
| Share image text | The promise | "AI Native Community Weaver Platform. Paid Forward Already." ("AI Native" is on the kit's never-write list) | Fixed |
| "pledge", never "bid" | | No UI string says "bid"; the assistant's instruction line quotes the word to forbid it | Nothing to fix; tested |
| Emoji | None, ever | One: "⚡ Create action" (Pathshala committee, concerns) | Fixed |
| Exclamation marks on the public pages | None | None | Nothing to fix; tested |
| "Connect number" | The portal says "Member no." and "Household no." | The website's household picture said "Connect number" | Fixed |
| Sentence case for headings and buttons | | The website follows it; the portal uses title case in places ("Admin portal", "Brand kit · colors and preview") | Not audited line by line; D11 |
| One faith's words in platform copy | None outside tenant and kind-driven text | Faith words live in the kind rows (`src/lib/kind.ts`, `kindTerm`). Leftover fallbacks: "Jai Jinendra" as the greeting when a kind has none (two places) and "derasar" as the fallback for a place (three places); the Boli email opens "Jai Jinendra," when no household name is known | The two greeting fallbacks in Setup › Profile fixed ("Welcome", the neutral kind's own greeting). The rest: D11 |
| "Sample data" on pictures of the product | | See (c) | D11 |
| Spelling "color" and "colour" | | Both are used in the portal ("Brand colors", "Colour") | Not changed |

## (f) Themes and settings that make pages off-brand

| Item | Status |
|---|---|
| Dark mode | None; `color-scheme: light`. Nothing to fix |
| Large-text mode | `docs/ARCHITECTURE.md` says "large-text mode"; no code implements it. The claim is stale (not a brand matter). Left in the doc, flagged here |
| "New look" per person | The portal has two shells chosen per person; both now read the kit, so the choice no longer changes colour |
| Tenant branding | Unchanged. A community's colours are used only in its own documents and screens, never for Weaver's chrome |
| Sandbox watermark, DEV PREVIEW banners | Danger tokens |

## Owner decisions

Each is a real design choice (two kit-valid options, a colour the kit lacks, or an asset missing). Nothing here was guessed.

| # | Decision | What stands now | Recommendation |
|---|---|---|---|
| D1 | The sun gradient on Niva's rail button, the Ask button and the Niva icon, against "gradient only on the AI tag, the headline underline and the picture wash; never for buttons" | Gradient kept (tested as "Niva's button only"); the website has the kit's AI tag | Make the AI tag the Niva mark everywhere: Niva's rail button a `navy-50` tile with an ink sparkle, the Ask button navy, and the `AiTag` ("Niva", "AI") on each AI line. One design pass, then remove the test line that pins the gradient |
| D2 | Portal button height (40, 36, 30 px; 12 to 13 px labels) against the kit's 52 px (48 px tap target) | Compact sizes kept | Keep compact in tables and toolbars (mouse); use `lg` (52 px) for the one primary action of a page and on phones; align label size to 14 px |
| D3 | A monospace for identifiers (245 uses; also the Brand page's hex codes) | JetBrains Mono, outside the kit | Add it to the kit as the identifier face (SIL OFL), for IDs only: `0417` and `O417` must stay distinguishable |
| D4 | Module hues the kit lacks: events maroon `#7a2e1f`, Pathshala and content purple `#5b4b8a`, store green `#2f5d50` (also the two pills in the website's pictures) | Unchanged; the only hex values in `src/styles/portal-tokens.css` | Use `navy` for every module tag and tile and let the words and icons carry meaning (the kit: "status always has words"); or add up to three accent tokens to the kit |
| D5 | The kit has `success` and `danger` only. The portal also shows warning, info, ok-button and warn-button states, and a third grey | Warning is `saffron-50` with `brown`, info is `navy-50`, the third grey is `muted`, hover shades are worked out from kit colours | Add `warning` (and its tint and ink) to the kit, with the contrast pairs |
| D6 | The WhatsApp Business module label "CommunityConnect" (`src/lib/modules.ts`, key `channels`) | Unchanged | "WhatsApp Business" |
| D7 | The flyer maker: its "Weaver default" palette (`#1B2C5C`, `#C9731C`, `#FBF7F0`), its bundled faces (Fraunces, DM Sans, Kaushan Script in `assets/flyer-fonts`), and the art packs | Unchanged; tenant output, with many tests pinning the defaults | Default the palette to the kit's `navy`, `brown`, `canvas`, and bundle Bricolage Grotesque and Hanken Grotesk (OFL WOFF files, as the current ones are) in a separate pull request. No font file was downloaded here |
| D8 | A portal icon set. The kit's 21 icons are for the website; the portal draws about 44 inline SVGs with eight stroke weights | Three thin strokes set to 2 | Extend the kit's set with the portal's icons at stroke 2 and move them to one `Icon` component |
| D9 | The mark in Weaver's own emails (sign-in codes, request outcomes) | The name "Weaver" as text | Show `https://www.weaverams.org/brand/weaver-mark-256.png` as the logo when the email has no community brand |
| D10 | Shape tokens the kit lacks: form-field radius (10 and 12 px), status-tag radius (8 px), the portal's hard-coded radii (507 `rounded-[Npx]`), card padding | Left as written | Add `radius-field` (12 px, the kit's `radius-logo-tile`) and `radius-tag`; then replace the pixel values in a mechanical pull request |
| D11 | Copy the guard cannot judge: a literal "Sample data" label on each product picture, sentence case across the portal, faith-word fallbacks (`kindTerm(..., "derasar")`, "Jai Jinendra") | Not changed | Label each picture "Sample data" in its title bar; one pass over portal headings; make the fallbacks null so a kind without the word says nothing |
| D12 | The kit file itself: `brand/tokens.json` `meta.paths.tokens` still names `src/app/site/site.css` and `src/app/globals.css`, and `meta.synced` is `2026-10-13` | Not edited, so that the copies in the other two repositories stay byte-equal | Bump the kit when the next token changes: point `paths.tokens` at `src/styles/brand-tokens.css` |

Corrected in the same pull request: `docs/ARCHITECTURE.md` ("Design tokens" listed the old palette and faces), `docs/ADMIN_REDESIGN.md` (the "Visual identity" table is superseded) and `docs/BACKLOG.md` (B81 is built for this repository, with the kit's values and not the table in the redesign plan).

## How this was checked

- Scanned all of `src/` (`.ts`, `.tsx`, `.css`, `.svg`; 1,521 files) for hex, `rgb()`, `rgba()` and `hsl()` values and Tailwind arbitrary colours, before and after, with comments left out; for font families, `next/font` calls, `@font-face` and `font-*` classes; for every use of `WeaverMark`, `icon.svg`, `apple-icon`, `opengraph-image` and the PNGs in `public/brand`; for `Community Connect`, `Connect`, `bid`, emoji and exclamation marks.
- Read `ui.tsx`, `controls.tsx`, `modal.tsx`, `drawer.tsx`, `toast.tsx`, `globals.css`, `site/ui.tsx` and the logo, header, footer and brand page against `brand/components/*`.
- Rendered in a browser (development server, placeholder environment with no database): the website home page and Brand page, `/login`, `/request-access`, `/demo`, the share image at 1200 by 630, and two portal developer previews (`/dev/giving-glance`, `/dev/admin-giving`, the "New look" shell). Fonts, radii, shadows and colours were read back from the computed styles.
- The new `tests/brand-conformance.test.ts` was shown to fail on a planted hex value, a Tailwind palette class, "Community Connect" and "bid".

Not checked: the portal's authenticated screens (there is no database in this environment, so most of the 138 screens were not opened; they are covered by the token swap and the scans, not by eye), a phone-width pass over the changed pages, the share image on a real social card, and the pledge PDF and email in a real client. The rendering of Bricolage Grotesque in the share image needs a network call to Google Fonts at the time the image is built.
