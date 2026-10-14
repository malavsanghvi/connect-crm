# Brand conformance: the portal and the website against the Weaver brand kit

Owner request, 2026-10-14: "Make sure all pages of the platform (admin / website / mobile app) etc use the same brand kit: colors / fonts / images / styling... everything."

The source of truth is the kit in `brand/` (`README.md`, `tokens.json`, `logos/`, `icons/`, `components/`) and the public Brand page that publishes it (`src/app/site/brand`). Where this repository's other docs disagree with `brand/tokens.json`, the kit wins. This file is the audit of `connect-crm` (the admin portal, the public website, and the portal's public pages `/login`, `/request-access`, `/start`, `/demo`, `/c/<slug>`), what was brought onto the kit in the same pull request, and what waits for the owner. The member app and the event-day app are audited in their own repositories.

A community's own name, logo and colours (`centers.branding`) are the community's identity and are not replaced by Weaver's. Weaver's own chrome (the product name, the mark, buttons, type and the colours of the platform itself) follows the kit.

**Owner decision, 2026-10-14: "go with your recommendations".** The twelve decisions this audit left open (D1 to D12, at the end) are decided and applied in the same pull request, first as a new version of the kit (`brand/tokens.json` version 2), then in the portal and the website. Where an item below says "decision Dn", read the table at the end for what was done.

## What changed in one paragraph

Before, the repository carried three palettes: the portal's "classic" look (the old Jain prototype: navy `#1B2C5C`, saffron `#C9731C`, warm paper `#F6F2EA`, Fraunces and DM Sans), the portal's "New look" (a cool blue palette of its own, `#1C56B0` and `#F3F7FB`, written up in `docs/ADMIN_REDESIGN.md`), and the website (the kit's palette, re-pointed by hand inside `.site-root`). Now `brand/tokens.json` (version 2) and `brand/icons/*.svg` are the one source: `scripts/sync-brand-tokens.mjs` writes `src/styles/brand-tokens.css`, `src/lib/brand-tokens.generated.ts`, `brand/weaver-tokens.css` and `src/components/brand/icons.generated.ts` (all committed; a test fails when one is out of date), `src/app/globals.css` imports the first, and the portal in both looks and the website read the same variables, utilities (`bg-navy`, `rounded-card`, `rounded-field`, `shadow-hero`, `font-display`, `border-line-control`), faces (Bricolage Grotesque and Hanken Grotesk, with JetBrains Mono for identifiers, loaded once in `src/app/layout.tsx`) and one `Icon` component. Code that cannot read a CSS variable (the share image, the home-screen icon, hand-written HTML pages) reads the same values through `src/lib/brand-colors.ts`. The portal's own additions are a small file with no colour value of its own, `src/styles/portal-tokens.css`: aliases, and shades worked out from kit colours.

## How the tokens flow

```
brand/tokens.json  ──  scripts/sync-brand-tokens.mjs  ──►  src/styles/brand-tokens.css  ──►  src/app/globals.css (@import)
   (the source)                                              (generated, committed)            ├─ the portal, classic look
        │                                                                                      ├─ the portal, "New look" (--v2-* names, aliases of the same tokens)
        │                                                                                      └─ the website (src/app/site, src/components/site)
        ├──►  src/lib/brand-tokens.generated.ts  ──►  src/lib/brand-colors.ts  ──►  share image, apple icon, 404 page, plain HTML pages, brand page swatches
        ├──►  brand/weaver-tokens.css  (the kit's own preview stylesheet, written by the same script)
        └──►  a verbatim copy in connect-mobile and connect-admin (copied like src/lib/database.types.ts; see brand/MAINTAINING.md)
```

```
brand/icons/*.svg  ──  scripts/sync-brand-tokens.mjs  ──►  src/components/brand/icons.generated.ts  ──►  <Icon name="..." />  (the website and the portal)
```

`tests/brand-conformance.test.ts` is the guard; `tests/look-tokens.test.ts` checks contrast (WCAG AA, 4.5:1) of the portal's text and surface pairs against the kit's own values. How to run both is in `brand/MAINTAINING.md`.

## Counts

| What | Before | After |
|---|---|---|
| Colour values written in `src/` (comments left out): hex, rgb(a), Tailwind arbitrary colours | 1,412 in 104 files | 1,144 in 40 files |
| ...that were neither a kit colour nor in a file the guard allows (drift) | 273 in 67 files | 0 |
| ...that equal a kit colour (allowed anywhere) | 109 | 22 |
| ...in files the guard allows, with a reason (flyer artwork, the generated token files, the logo's own drawing, tenant palettes) | 1,030 | 1,122 |
| Arbitrary Tailwind colour classes (`bg-[#...]`, `text-[#...]`, `border-[#...]`) | 115 | 0 |
| Arbitrary shadows and scrims with an rgba value | 31 | 0 |
| `text-saffron` (the kit: saffron is never text) | 28 | 0 (now `text-brown`) |
| `font-extrabold` and `font-weight: 800` (the kit's type tops out at 700) | 58 | 0 |
| Product-name drift in a string a person reads ("Community Connect", "CommunityConnect", "Connect approves") | 14 | 6, each allowlisted in the test with its reason |
| Hard-coded radii that equal a kit radius (`rounded-[10px]`, `[12px]`, `[16px]` ...) | 395 | 0 (the 113 that remain are 14, 18, 22, 28 px and smaller: no kit value) |
| Module hues (purple, maroon, store green) in classes, tones and tokens | 95 | 0 (one hue, `navy`, decision D4) |
| Inline `<svg>` icons in the portal's components | 34 | 0 (the shared `Icon`, decision D8) |
| Control borders in `line-input` (1.4:1) | 38 classes and 43 `--v2-line-input` uses | 0 and 41 (now `line-control`, 3.5:1) and 2 left inside the website's pictures |
| Warning boxes and chips in the saffron tint | 77 `bg-saffron-50` | 43 (42 lines of messages and status chips moved to `warning`; the rest are accent tints and AI lines) |

## (a) Colours

| Item | The kit says | The surface did | Status |
|---|---|---|---|
| Portal, classic look: the whole `@theme` | Indigo `navy #2b2a8a`, `saffron #ff7640`, `canvas #fffaf5`, `ink #1e1d5c`, `muted #555a79` ... | Old Jain prototype palette (navy `#1b2c5c`, saffron `#c9731c`, canvas `#f6f2ea`, ink `#1e1c18`) | Fixed: the generated kit tokens replace it |
| Portal, "New look" (`[data-look="v2"]`) | Same tokens | A second palette of its own (blue `#1c56b0`, page `#f3f7fb`, ink `#12203a`) that also re-pointed the portal's token names | Fixed: its 32 `--v2-*` names stay (about 400 uses) and now point at kit tokens; the two looks differ in layout, not colour. `tests/look-tokens.test.ts` rewritten against the kit |
| Website theme | Same tokens | `.site-root` re-pointed 21 tokens by hand, matching the kit today | Fixed: the website reads the global tokens; `site.css` keeps only the face |
| Hard-coded colours in components | A token | Of the 273 off-kit values: 90 in `globals.css` and 183 in components and libraries (the public dashboard 26, the Giving ask flow 10, emails 9, the check-in screen 7, bar colours 7). That includes 115 arbitrary colour classes, 31 arbitrary shadows or scrims, and the error-box pair `#7a1a14` and `#f0b9b4` written 41 times, cool tints `#eaf0f7`, an amber `#fff4d6`, a blue `#16306b` | Fixed: error boxes are `border-danger/30 bg-danger-50 text-danger`, tints are `navy-50`, `saffron-50`, `track`, scrims are `bg-ink/45`, shadows are the kit's `shadow-menu`, `shadow-window`, `shadow-hero`, `shadow-panel` |
| Saffron as text | "It is never text" (white on saffron 2.6:1; saffron on white below 3:1) | 28 `text-saffron` (nav counts, money, warnings, the Niva glyph, the website's 404) and a navigation count badge of white on saffron | Fixed: `text-brown` (6.2:1 on white); the badge is ink on saffron (5.7:1) |
| Gradients | Only the AI tag, the headline underline, the picture wash | Two progress bars with gradients (the giving panel's sun gradient, the onboarding bar in the logo's `mark-*` colours); the headline underline written as a raw `rgba` gradient | Fixed: progress fills are `navy`; the underline is the class `.site-underline` built from `gold` and `saffron` |
| Gradient on the Niva button | "Never use it for buttons or backgrounds" | The sun gradient filled the Niva orb in the rail, the Ask button in Giving and the Niva icons | Fixed, decision D1: Niva's button is a `navy-50` tile with an ink sparkle, the Ask button is navy, the composer's sparkle is navy, `NivaMark` is the AI tag, every assistant message and "Niva noticed" carry the tag; `--v2-sun`, `--v2-sun-from` and `--v2-sun-to` are gone and the guard fails on a gradient outside the kit's three places |
| `mark-*` colours in the interface | "The mark colours belong to the logo only" | Only in the onboarding progress bar | Fixed (above); the guard now fails on any `bg-mark-*` class |
| Warning and info states | `success`, `danger` and now `warning` (with `warning-50`, `warning-200`, `warning-ink`) | The portal's warning was amber (`#8a4608`, `#fff4d6`), its info a cool blue | Fixed, decision D5: warning messages, status chips and `Alert` use the kit's warning tokens (42 lines in 34 files); info is `navy-50` |
| Third grey (`faint`) | `faint` `#666b86` (5.2:1 on white, 5.1:1 on canvas) | `faint` `#8a8478` (3.7:1 on white: placeholders, disabled text, 77 uses) | Fixed, decision D5: `--color-faint` is the kit's token; the disabled button's text is `muted` (faint is 4.1:1 on its fill) |
| Module hues | One hue, `navy`, for tags and tiles of the parts of a product | Events maroon, Pathshala and content purple, store green; 95 uses; the website's mockup pills reused purple and maroon | Fixed, decision D4: every tone, tag colour, stat colour and bar that was purple, maroon or store green is navy (43 files); the tone and colour types lost those names; the words and icons say which part it is. `src/styles/portal-tokens.css` now holds no colour value |
| Public dashboard `/c/<slug>` | Kit tokens | A second warm palette (`#e8e0d2` borders, `#f6efe3`, `#e8892a` button with white text) | Fixed: `line`, `track`, the kit's tint pairs, and the gold button on the navy band (`gold` with `navy` text) |
| Event-day check-in screen in this repository (`src/app/ops`) | Kit tokens | Seven amber and pastel hex values | Fixed: `gold`, `navy-100`, `success-200`, `danger-200` (shades of kit colours) |
| Bar and progress colours (`bar-list.tsx`) | Kit tokens | Eight hex values | Fixed: they read `var(--color-...)` |
| Browser theme colour (`viewport.themeColor`) | `navy` | `#1B2C5C` | Fixed: `brandColor("navy")` |
| Share image (`opengraph-image.tsx`) | The hero: saffron band, white card, the promise in Bricolage | Old canvas `#F6F2EA` and navy, no real faces, and the text "AI Native Community Weaver Platform. Paid Forward Already." | Fixed: see (c) and (e) |
| Apple touch icon | The mark on `white` | Mark on `#ffffff` | Kept as drawn; the colour now comes from the kit (`brandColor("white")`) |
| Emails (`src/lib/messaging/email.ts`) | Kit tokens | A fourth set (`#7a3e12` fallback brand colour, `#f6f3ee`, `#1f1a14`, `#6f6556`) and a banner of amber | Fixed: `EMAIL_PALETTE` holds the kit's canvas, ink, muted, line, navy, `saffron-50`, `saffron-200`, `brown-900` (the sandbox banner could take the warning tokens: left as the AI-line pair); a community's own colour still wins for its header rule and name |
| Pledge PDF defaults | Kit tokens | Old navy `#1B2C5C` and saffron `#C9731C` as the platform colours, and grey-brown inks | Fixed: defaults are the kit's `navy` and `brown`; the inks are the kit's `ink`, `muted`, `line`. The test that pinned the old default was updated |
| Raw HTML pages (unsubscribe, payment return, the website's 404) | Kit canvas, ink, face | `#1f1a14`, `#1f2937`, `#F6F2EA`, `#C9731C` | Fixed through `src/lib/brand-html.ts` |
| Calendar layer default, example hex codes in messages (`#1B2C5C`, `#1B5E9C`), import sample | Kit values | Old values | Fixed: `#2B2A8A`, `#A8400D` |
| Colours a community chose | Not Weaver's | `centers.branding` colours in flyers, the website draft, the setup helper; the setup screen's defaults | Kept (allowlisted with a reason). The defaults for a community with no colours of its own are now Weaver's (`DEFAULT_COMMUNITY_PALETTE`: navy and brown) in the setup screens and the pledge PDF, and the flyer maker's defaults are the kit's navy, gold and canvas (decision D7) |
| Dark mode | The kit defines `light` only | `html { color-scheme: light }`; no `prefers-color-scheme` anywhere (tested for the v2 section) | Nothing to fix |
| Window title dots on the website's pictures | "A `ground` title bar with three dots" (no colours named) | Two off-kit dots (`#e5836f`, `#7dbb97`) | Fixed: `saffron`, `gold`, `success` |
| Control borders | `line-control`, 3:1 against white and canvas (new in kit version 2) | `line-input` (1.4:1 on white) on fields, chips and selects; the event-day app and the member app both flagged it | Fixed, decision D5/D10: `.crm-input`, `.cc-code-input`, the top-bar search, 36 `border-line-input` classes and the 43 `--v2-line-input` uses are `line-control`; the off state of a switch is `line-control` too |
| Orange that carries white text | `saffron-strong` (new in kit version 2): 4.7:1 with white; `saffron` is decoration only | The member app found white text on saffron at 2.6:1 | In the kit, with the rule "decoration is saffron, text and buttons are saffron-strong"; the portal has no white text on saffron (the nav count badge is ink on saffron), so it has nothing to change |

## (b) Fonts

| Item | The kit says | The surface did | Status |
|---|---|---|---|
| Portal display and text faces | Bricolage Grotesque (display), Hanken Grotesk (everything else), loaded with the optical-size axis | Fraunces and DM Sans through `next/font` in the root layout | Fixed: the root layout loads Bricolage Grotesque (`opsz` axis) and Hanken Grotesk once for the portal and the website; `--font-display` and `--font-sans` come from the generated tokens; the website's own second loading was removed |
| Fallbacks | `"Hanken Grotesk", ui-sans-serif, system-ui, sans-serif` | Georgia for display, system-ui for text | Fixed: the kit's stacks sit behind the loaded face |
| Identifiers (receipt, pledge and member numbers) | JetBrains Mono for identifiers only (new in kit version 2: `type.families.mono`, the `identifier` style) | JetBrains Mono, 245 `font-mono` uses, and the Brand page's hex codes | In the kit, decision D3: `--font-mono` is generated from it, the root layout loads it as `--font-jetbrains`, and the Brand page shows it as the third face |
| Weights | 400 to 700 | 55 `font-extrabold` and 3 `font-weight: 800` rules | Fixed: 700 |
| Type scale | `hero`, `heading`, `lead`, `body`... for the website | The website follows it (checked by reading, not by a test); the portal has its own denser scale (11 to 28 px) | Portal scale kept: a dense admin tool, not a public page |
| Emails | Hanken Grotesk | `system-ui` | Fixed: Hanken Grotesk first, the system face where an email client does not have it |
| Share image | Both faces | The built-in face of `next/og` | Fixed: `src/lib/brand-og.ts` loads Bricolage Grotesque 600 and 700 and Hanken Grotesk 600 and 700 from Google Fonts (as `src/lib/events/flyer-fonts.ts` does for other families), and draws in the built-in face, logged, if the fetch fails |
| Hand-written HTML pages | Kit face | `system-ui` | Fixed to name the kit's stack; no web font is loaded for them |
| Pledge PDF | Not specified | Built-in Helvetica, on purpose: pdf-lib's standard font, no font file to ship to the background service, and the pledge document is the community's own statement | Kept; noted in the file |
| Flyer maker | A community's own flyer | Bundled Fraunces, DM Sans, Kaushan Script, and the community's chosen faces | Faces kept for now, decision D7: Bricolage Grotesque and Hanken Grotesk need WOFF files downloaded and committed under `assets/flyer-fonts` (a download not done here); the colour defaults are the kit's |
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
| Emails | Header and footer carry the logo | A community's logo, else its name; the mark was not in Weaver's own emails (sign-in codes) | Fixed, decision D9: an email with no community brand shows Weaver's mark (`https://www.weaverams.org/brand/weaver-mark-256.png`) beside the name; a community's own logo or name always wins; the worker's emails get it too because the code is shared |
| PNG downloads | The kit's seven files | `brand/logos` and `public/brand` hold the same seven | In step; tested |
| Stock or placeholder images | None | None in `public/` or `src/` (only `public/brand/`) | Nothing to fix |
| Pictures of the product | Drawn in HTML and CSS, in a window frame, labelled "Sample data" | `src/components/site/mockups.tsx` draws them in frames titled "Sample Community..." and the footer says "Screens on this site show sample data"; the household picture said "Connect number" | Fixed, decision D11: "Household no." as the portal says it, and a "Sample data" tag in the title bar of every window frame and on the phone picture |
| Brand page swatches | Kit values | Six hex strings typed by hand | Fixed: read from `brand/tokens.json` |

## (d) Styling

| Item | The kit says | The surface did | Status |
|---|---|---|---|
| Buttons, website (`src/components/site/ui.tsx`) | Pills, 52 px (56 in the hero), `button` 16 px; primary, ghost, gold, ghostOnNavy; focus 2 px navy, offset 4 px | Implements all four; gold hover was a literal `#ffc84a` | Fixed: `gold-hover`, a shade of `gold`; the rest was in step |
| Buttons, portal (`.cc-btn`) | The same four styles, plus `accent` (saffron-strong) | Primary matched; ghost was a 1 px solid navy border; radii were pixel values; the focus offset was 2 px; ok, warn and bad variants have no counterpart in the kit | Fixed: pill radius from the token, the ghost is "white, 2 px border of navy at 20%, navy on hover", the focus offset is 4 px on buttons, sizes as in decision D2. The ok, warn and bad variants stay as the portal's status buttons: fills of `success`, `brown` and `danger`, all of which carry white text at 4.5:1 or better |
| Button size and tap target | `control-primary` 52, `control-compact` 40, `control-dense` 36; `tap-target` 48 on touch (new tokens and rules in kit version 2) | Portal: 52 (`lg`), 40, 36, 30 px; 12 to 13 px labels | Fixed, decision D2: the compact sizes stay in tables and toolbars (`--control-compact`, `--control-dense`); labels are 14, 13 px; a page's primary action (`.cc-page-actions .cc-btn-primary`) is 52 px; under `(pointer: coarse)` every button is at least 48 px and fields are 48 px with a 16 px label |
| Cards | White on canvas, 1 px `line`, `radius-card` (24 px), `card-pad`; `radius-tile` for small cards | Website: in step (now the token classes). Portal: white, 1 px line, 16 px | The portal's 16 px is the kit's `radius-tile` ("small cards"); the card now says so. Padding and density kept |
| Chips and tags | Pill for chips; `radius-chip` (6 px) for the AI tag; `radius-tag` (8 px) for status tags | Portal chips: 16 px on 32 px (a pill); status tags 8 px | Fixed: chips are the pill token; `.cc-tag` is `radius-tag`; 8 px classes are `rounded-tag` |
| AI tag and AI line | Gold-to-saffron tag on `saffron-50`, `radius-chip`, white dot; Niva is the tag labelled "Niva" | Website: in step. Portal: no AI tag; Niva appeared as a sparkle glyph, an orb and the word "Niva" | Fixed, decision D1: one `AiTag` (`src/components/brand/ai-tag.tsx`) on the website and in the portal (assistant messages in Niva's panel, "Niva noticed", Niva's turns in the Ask flow) |
| Form fields | `line-control` border, `radius-field` (12 px), 40 px (48 on touch) | Portal 10 px radius, 42 px high, `line-input` border, 2 px navy focus ring; the onboarding pages 12 px | Fixed, decisions D5 and D10: `radius-field`, `line-control`, `--control-compact` |
| Tables | `ground` panels, `line` rules | Canvas header row, `line-soft` rules, `highlight` row | Colours fixed; the highlight is `saffron-50`; the header bar's corners are `radius-field` |
| Toasts, modals, drawers | Not specified | 14, 22 and side-sheet shadows in pixel values | Fixed to kit shapes where the kit has a name: toast `radius-tile`, modal `radius-card`, shadows composed from `ink`, menus `shadow-menu`, modals and sheets `shadow-window`. The 22 px of the bottom sheets and onboarding buttons has no kit name and stays |
| Focus ring | 2 px solid `navy`, offset 2 px (4 px on buttons) | In step | Fixed for buttons |
| Layout tokens | `container 1160`, `gutter`, `section-y`, `card-pad`... | The website uses the numbers as Tailwind arbitrary values (`max-w-[1160px]`) | The tokens are now emitted as `--container` and the rest; replacing the website's numbers with them is cosmetic and was not done |
| Radii | Named tokens: `radius-pill`, `-band`, `-hero`, `-card`, `-window`, `-tile`, `-field`, `-logo-tile`, `-tag`, `-chip` | 508 hard-coded `rounded-[Npx]` in the portal and the CSS in pixels | Fixed, decision D10: every pixel value equal to a kit radius (6, 8, 10, 12, 16, 20, 24, 32, 40) is its token class (395 classes), the CSS uses the tokens, buttons and chips are pills; the guard fails on a new one. Left: 113 classes at 14, 18, 22 and 28 px or less, which the kit has no name for |
| Icons | 42 stroke icons on a 24 px grid, stroke 2, round caps, no fill (the 21 of kit version 1 and 21 the portal needed) | The website used the 21. The portal drew 34 inline SVGs of its own, with strokes of 1.6 to 3.4 | Fixed, decision D8: the portal's icons are in `brand/icons` (alert, approve, bank, count, eye, file, help, info, list, more, pencil, person, plus, refund, search, send, server, settings, sparkle, star, upload); one `Icon` component (`src/components/brand/icons.tsx`) generated from the files serves the website and the portal; the workspace icons in the rail, Giving's row icons, Niva's sparkle and the people finder are kit icons by name; the guard fails on an inline `<svg>` |

## (e) Voice in UI copy

| Item | The kit says | The surface did | Status |
|---|---|---|---|
| Product name | "Weaver", never "Community Connect" or "Connect" | Seven user-facing strings said "Community Connect" (the payments pause, the readiness check, the Stripe notes) and one said "Connect approves your request" (the code-redemption page) | Fixed. Kept on purpose and allowlisted: the QuickBooks marker "Community Connect test post" (migration 0234, `docs/DECISIONS.md`), the audit reason `CC_FIRST_ADMIN_REASON` (migration 0400), and the database's "Community Connect has paused ..." (migrations 0580 and 0597, applied; the code now accepts "Weaver has paused" too). 83 applied migration and test files still say it; a new migration is the way to change them (already noted in `docs/DECISIONS.md`) |
| The module label "CommunityConnect" (Settings › Modules, `src/lib/modules.ts`, key `channels`) | "Weaver", never "Community Connect" | It is the owner's name for the Facebook, Instagram and WhatsApp marketplace pack (B104, `docs/MARKETPLACE_PACKS.md`), a pack brand like iWeaver, WeaverSite and WeCare | Kept, decision D6: see the table at the end |
| The AI line | "AI does the busywork. People make the final decisions." word for word | Paraphrased three times: the home page's hero ("AI does the busywork, and people make the final decisions"), the site description ("...busywork and people make..."), the header menu ("AI does the busywork; people decide") | Fixed; the test fails on any "AI does the busywork" that is not followed by the second sentence |
| The other lines (promise, why it is free, belief, partner promise, leaving, closing, generosity, descriptor) | Word for word | In place on the home page, `src/lib/brand.ts`, `src/lib/site.ts` and the Brand page | In step; tested against `brand/README.md` |
| Share image text | The promise | "AI Native Community Weaver Platform. Paid Forward Already." ("AI Native" is on the kit's never-write list) | Fixed |
| "pledge", never "bid" | | No UI string says "bid"; the assistant's instruction line quotes the word to forbid it | Nothing to fix; tested |
| Emoji | None, ever | One: "⚡ Create action" (Pathshala committee, concerns) | Fixed |
| Exclamation marks on the public pages | None | None | Nothing to fix; tested |
| "Connect number" | The portal says "Member no." and "Household no." | The website's household picture said "Connect number" | Fixed |
| Sentence case for headings and buttons | Capitals only in the eyebrow and the AI tag | The website follows it; the portal is in sentence case apart from product names (a scan of labels, titles and text found two Title Case headings), but 133 labels and kickers are set in capitals (`uppercase`) | Two headings fixed ("From events", "From people"), decision D11. The capital-letter kickers and table headers are the portal's eyebrow style and were left |
| One faith's words in platform copy | None outside tenant and kind-driven text | Faith words live in the kind rows (`src/lib/kind.ts`, `kindTerm`). Leftover fallbacks: "Jai Jinendra" as the greeting when a kind has none (two places), "derasar" as the fallback for a place (two places) and "Jai Jinendra," opening the Boli email when no household name is known | Fixed, decision D11: "Welcome", "office", "place of worship" and "Hello," |
| "Sample data" on pictures of the product | Every picture of the product | See (c) | Fixed, decision D11 |
| Spelling "color" and "colour" | | Both are used in the portal ("Brand colors", "Colour") | Not changed |

## (f) Themes and settings that make pages off-brand

| Item | Status |
|---|---|
| Dark mode | None; `color-scheme: light`. Nothing to fix |
| Large-text mode | `docs/ARCHITECTURE.md` says "large-text mode"; no code implements it. The claim is stale (not a brand matter): flagged here, not changed |
| "New look" per person | The portal has two shells chosen per person; both now read the kit, so the choice no longer changes colour |
| Tenant branding | Unchanged. A community's colours are used only in its own documents and screens, never for Weaver's chrome |
| Sandbox watermark, DEV PREVIEW banners | Danger tokens |

## Decisions (owner, 2026-10-14: "go with your recommendations")

Each decision was a real design choice (two kit-valid options, a colour the kit lacks, or an asset missing). The owner took the recommendation for all twelve. Kit changes were made first (`brand/tokens.json` version 2, the README, the component guides, `brand/icons`, the Brand page, `brand/MAINTAINING.md`) so the member app and the event-day app can copy them; the portal and the website follow.

| # | Decision | Status | What was done |
|---|---|---|---|
| D1 | Niva is marked by the AI tag, not a gradient | Done | The kit's README, `components/AiTag` and `Button` say it. Portal: the sun gradient (`--v2-sun`, `-from`, `-to`) is removed; Niva's rail and phone-bar button is a `navy-50` tile with an ink sparkle; the Ask button and the composer's sparkle are navy; `NivaMark` is `<AiTag label="Niva">`; each assistant message in Niva's panel and "Niva noticed" carry the tag; `tests/look-tokens.test.ts` now pins "no colour of its own" and the guard fails on a gradient outside the AI tag, the headline underline, the picture wash and the rail's scroll fade |
| D2 | Control sizes: 52 px for a page's primary action and on phones, 40 and 36 px compact in dense mouse tables, 48 px on touch | Done | Kit tokens `control-primary`, `control-compact`, `control-dense`, `tap-target` and the rules in the README, `components/Button` and `components/Control`; `caption` (14.5 px) is the smallest text on a touch surface. Portal: `.cc-btn` at 40/36/30 px with 14, 13, 12 px labels, `.cc-page-actions .cc-btn-primary` at 52 px, `@media (pointer: coarse)` raises every button to 48 px and fields to 48 px with a 16 px label |
| D3 | Add JetBrains Mono to the kit as the identifier face | Done | `type.families.mono` and the `identifier` style; `--font-mono` is generated, the root layout loads it as `--font-jetbrains`, the Brand page shows the third face, the guard accepts exactly the three kit faces |
| D4 | Module tags use navy only | Done | 95 uses of purple, maroon and store green are navy (43 files); the tone, tag-colour, stat-colour and bar types lost those names; the Giving campaigns bar series is saffron, navy, green, grey, brown; `portal-tokens.css` holds no colour value; the guard fails on `-purple`, `-maroon` and `-store` utilities |
| D5 | A warning colour, control border, strong accent and faint text in the kit | Done | Kit: `warning`, `warning-50`, `warning-200`, `warning-ink`; `line-control`; `saffron-strong`; `faint`, each with its contrast pairs (tested). Portal: warning messages, chips, `Alert`, `.cc-status-warn` and the warn text use the warning tokens; `faint` and the switch's off state are the kit's; fields, chips and selects use `line-control` |
| D6 | The module label "CommunityConnect" becomes "WhatsApp Business" | Not applied: needs the owner's confirmation | While applying it, the label turned out to be the owner's own name for the Facebook, Instagram and WhatsApp marketplace pack (B104, `docs/MARKETPLACE_PACKS.md`: iWeaver, WeaverSite, CommunityConnect, WeCare, CatchTheMatch), not the old product name; renaming it would contradict that plan, and "WhatsApp Business" would be wrong once Facebook and Instagram arrive. The label stays; the guard's allowlist line now says why. If the pack is to be renamed, change `src/lib/modules.ts`, `tests/modules.test.ts` and `docs/MARKETPLACE_PACKS.md` together |
| D7 | The flyer maker's defaults and bundled faces | Part done | Default palette is the kit's navy, gold and canvas (`FLYER_BRAND_DEFAULTS`, the art palette, the pattern and icon fallbacks; tests updated; a guard test keeps them equal to the kit). The faces stay Fraunces and DM Sans: Bricolage Grotesque and Hanken Grotesk have to be downloaded as WOFF files (SIL OFL) into `assets/flyer-fonts` and added to `src/lib/events/flyer-fonts.ts`, and a font download was not done here. Follow-up: branch `feat/brand-flyer-defaults`, which needs the files and the owner's go-ahead to download them |
| D8 | One icon set | Done | 21 portal icons added to `brand/icons` at stroke 2 (42 in all); `scripts/sync-brand-tokens.mjs` generates the `Icon` component's markup from the files; the website's icon file is gone; 34 inline SVGs, the workspace icons, Giving's row icons and the people finder's icons use it; the guard fails on an inline `<svg>` |
| D9 | Weaver's mark in Weaver's own emails | Done | `renderEmail` with no community brand shows `weaver-mark-256.png` beside the name; a community's logo or name wins; tested |
| D10 | Shape tokens | Done | Kit: `radius-field` (12 px) and `radius-tag` (8 px). Portal: fields, rows and tiles at 10 or 12 px are `radius-field`, status tags `radius-tag`, every other pixel value that equals a kit radius is its token class (395 classes and the CSS); the guard fails on a new one. 113 classes at 14, 18, 22 and 28 px or less remain: the kit has no name for them |
| D11 | Copy the guard cannot judge | Done | "Sample data" in the title bar of every picture of the product on the website; two Title Case headings made sentence case (the portal was already sentence case: the scan found two; capital-letter kickers are its eyebrow style); the faith-word fallbacks are "Welcome", "office", "place of worship" and "Hello," |
| D12 | The kit file's own bookkeeping | Done | `brand/tokens.json` version 2, `meta.synced` 2026-10-14, `meta.paths` and `meta.components` point at today's files |


Corrected in the same pull request: `docs/ARCHITECTURE.md` ("Design tokens" listed the old palette and faces), `docs/ADMIN_REDESIGN.md` (the "Visual identity" table is superseded) and `docs/BACKLOG.md` (B81 is built for this repository, with the kit's values and not the table in the redesign plan).

## How this was checked

- Scanned all of `src/` (`.ts`, `.tsx`, `.css`, `.svg`; 1,521 files) for hex, `rgb()`, `rgba()` and `hsl()` values and Tailwind arbitrary colours, before and after, with comments left out; for font families, `next/font` calls, `@font-face` and `font-*` classes; for every use of `WeaverMark`, `icon.svg`, `apple-icon`, `opengraph-image` and the PNGs in `public/brand`; for `Community Connect`, `Connect`, `bid`, emoji and exclamation marks.
- Read `ui.tsx`, `controls.tsx`, `modal.tsx`, `drawer.tsx`, `toast.tsx`, `globals.css`, `site/ui.tsx` and the logo, header, footer and brand page against `brand/components/*`.
- Rendered in a browser (development server, placeholder environment with no database): the website home page and Brand page, `/login`, `/request-access`, `/demo`, the share image at 1200 by 630, and two portal developer previews (`/dev/giving-glance`, `/dev/admin-giving`, the "New look" shell). Fonts, radii, shadows and colours were read back from the computed styles.
- The new `tests/brand-conformance.test.ts` was shown to fail on a planted hex value, a Tailwind palette class, "Community Connect" and "bid".

- Second round (the decisions): regenerated the four token files, rendered the website's Brand page and a developer preview, ran the whole test suite, `eslint` and `tsc`. The contrast of every new token pair is asserted (`tests/brand-conformance.test.ts`, `tests/look-tokens.test.ts`), and the guard tests were extended: no inline `<svg>`, no pixel radius that equals a kit radius, no gradient outside the kit's places, no `line-input` on a control, no purple, maroon or store utility.

Not checked: the portal's authenticated screens (there is no database in this environment, so most of the 138 screens were not opened; they are covered by the token swap and the scans, not by eye), a phone-width pass over the changed pages, the share image on a real social card, and the pledge PDF and email in a real client. The rendering of Bricolage Grotesque in the share image needs a network call to Google Fonts at the time the image is built.
