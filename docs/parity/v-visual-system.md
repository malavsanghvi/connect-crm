# Community Connect: prototype vs app look-and-feel audit

Nothing was edited, committed or pushed. I rendered all six prototypes with Playwright; the fonts loaded. Screenshots are in `/tmp/claude-0/audit/visual/`:
- `proto-AdminPortal.png` (login) and `proto-AdminPortal-app.png` (treasurer home)
- `proto-CommunityDashboard.png`
- `proto-Main-home.png`, `-Events.png`, `-Give.png`, `-JainWay.png`, `-Family.png`
- `proto-Onboarding.png`, `proto-Welcome.png`, `proto-GyanPath.png`
- `mobile-icons.png` (mobile app icons next to the JSH assets)

I did not render the real apps. `next dev` writes `.next/` into the repos, which would break read-only, and the apps need Supabase. The app side of this audit is based on reading the code.

## Summary
- **Mobile (connect-mobile) is closest.** `src/theme.ts` already copies about 95% of the prototype palette, and `docs/PROTOTYPE_SPEC.md §5` is an accurate token spec. The gaps are in components:
  - icon set
  - header buttons
  - secondary button and chip styling
  - input style
  - drawer
  - welcome screen
  - **every icon and splash image is still the Expo template placeholder**
- **Portals (connect-crm, connect-admin) look different from AdminPortal.dc.html in structure, not just colour:**
  - The navigation is a dark navy sidebar; the prototype has a white 60px top bar and a white 220px sidebar.
  - Buttons are square (8px corners); the prototype uses pill buttons (20px corners).
  - Page titles are navy and card titles use the display font; in the prototype both are ink, and card titles are DM Sans 16/700.
  - KPI tiles use a coloured top border; the prototype uses tinted tiles with DM Sans 24/800 numbers.
  - The page background is `#FBF7F0`; the prototype uses `#F6F2EA`.
  - Card borders are `#E8E0D2`; the prototype uses `#E3D9C8`.
  - There is no danger red `#B3261E` in connect-crm; maroon is used for errors instead.
  - There is no toast, modal or side drawer component.
- **Brand:** the product appears as "Connect", "Connect CRM" or "Connect Admin" in about 40 user-visible places. Nothing says "Community Connect" yet.

---

## 1. Prototype design system (extracted)

### 1.1 Fonts
Every prototype has this in its `<helmet>`:
`<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap">`

- AdminPortal and CommunityDashboard also load JetBrains Mono. It is not used in any rendered AdminPortal markup; only the hidden API-calls panel logic refers to it.
- Main and Onboarding load DM Sans 400/500/600 only but use 700 and 800, which the browser fakes.
- **Display font:** `'Fraunces', Georgia, serif`, weights 500 and 600 only.
- **Body font:** `'DM Sans', system-ui, sans-serif`. Weights used: 400, 500, 600, 700, 800 (800 for KPI numbers and badges).
- Buttons and inputs use `font-family: inherit`.

**Type roles, admin (AdminPortal.dc.html):**

| Element | Font | Size / weight | Colour | Other | Source |
|---|---|---|---|---|---|
| Login hero | Fraunces | 38 / 600 | #FFFFFF | line-height 1.15 | L27 |
| Page title | Fraunces | 28 / 600 | ink #1E1C18 (not navy) | subtitle 13px #5E5A52 | L77 |
| Top-bar product name | Fraunces | 18 / 600 | #1B2C5C | | L59 |
| Drawer title | Fraunces | 22 / 600 | ink | | L185 |
| Modal title | Fraunces | 24 / 600 | ink | | L221 |
| Card title | DM Sans | 16 / 700 | ink | hint 12px #5E5A52 | L93 |
| KPI value | DM Sans | 24 / 800 | colour per metric | label 12/600 muted; sub 11px muted | L100 |
| Table header | DM Sans | 11 / 700 | #5E5A52 | letter-spacing 0.04em, text written in CAPS | L122 |
| Table cell | DM Sans | 13 / 500 | ink | status = bold 700 coloured text, not a pill (`G = (t) => ({ text: t, weight: 700, color: '#1F7A4D' })`) | |
| Kicker | DM Sans | 11 / 700 | #8A4608 | letter-spacing 0.06em, caps | |
| Section label | DM Sans | 12 / 800 | #5E5A52 | letter-spacing 0.04em, caps | |
| Form label | DM Sans | 12 / 700 | #5E5A52 | 11/700 inside the drawer | |
| Nav item | DM Sans | 14 | | weight 800 active / 600 idle | |
| Tab | DM Sans | 14 / 700 | | | |
| Button | DM Sans | 13 / 700 | | 12 in small sizes | |

**Type roles, member app (Main.dc.html):**
- Screen title: Fraunces 22/600 navy, left-aligned.
- Home card headlines: Fraunces 18–24/500.
- Event card title: Fraunces 18/500.
- Body: 15 and 14. Meta: 13. Captions: 12.
- Eyebrow: 12/700 #5E5A52, letter-spacing 0.06em, caps, padding `4px 4px 0`.
- Primary CTA text: 16/600.
- Tab bar labels: 12/600.
- Line-heights: 1.3–1.55.
- Onboarding hero: Fraunces 34/600, line-height 1.15.

Font sizes used in Main, by count: 12 (168), 15 (126), 13 (123), 14 (106), 16 (53), 18 (43).

### 1.2 Colour palette (hex → role)

**Core colours:**

| Hex | Role |
|---|---|
| **#1B2C5C** navy | Primary buttons, active nav/tab, links, selected chips, screen titles, avatar, member-card button |
| #0F1B3D | Link hover (`a:hover{color:#0F1B3D}`) |
| #EEF1F8 | Navy tint: active nav background, selected persona/row, info chips |
| #E6E9F3 | Second navy tint |
| #C9D1EA | Text on navy (login panel copy) |
| #B8C2DD | Navy border |
| #8A93AE | Disabled navy |
| #33467A / #26396E | Navy panels (Welcome, GyanPath) |
| **#C9731C** saffron | Accent: nav count badge, progress fill, GyanPath |
| #F2B632 | Gold (stars) |
| #E8892A, #F2A03D | Badge / flame |
| **#8A4608** brown | "warn" button, kickers, money figures, Niva FAB |
| #5E3106 / #5E4A33 | Dark brown text on tint |
| #FBEBD7 | Brown tint |
| #EFCFA6 | Brown border |
| #F6DDBF | Text on brown |
| **#1F7A4D** green | "ok" button, toggle on, success toast, positive status |
| #14502F / #2E5D43 | Dark green text |
| #E4F2EA | Green tint |
| #B7DCC6 | Green border |
| #7FD1A4 | Green on navy |
| **#B3261E** red | "bad" button, danger, refund/QuickBooks tags, error toast, PROTOTYPE badge |
| #FBE3E1 | Red tint |
| #C0392B | LIVE dot |
| **#7A2E1F** maroon | Events band, in-app confirm header |
| #8F4232 | Maroon close button |
| #F3D6CF | Text on maroon |
| **#5B4B8A** purple | Feedback, Pathshala, content tags |
| #EFEBF6 | Purple tint |
| #F5F2FA / #D8CFEA | Purple card background / border |
| #3D2F63 | Dark purple text |
| **#2F5D50** store green | Store, WhatsApp/Inbox tags, cart bar |
| #E8F1ED / #CFE6DC / #3E7566 | Store tint / on-store text / light store |

**Surfaces:**

| Hex | Role |
|---|---|
| #EDE6DA | Frame behind all artboards (`body{background:#EDE6DA}`); "off" button background |
| **#F6F2EA** | **Admin app background**, table header bar, search pill, read-only fields |
| **#FBF7F0** | Member app background, dashboard background, admin KPI tiles, key-value rows, check groups, centre-switcher pill |
| #FFFFFF | Cards, top bar, sidebar, drawer |
| #F6EFE3 | Segmented-control track, tinted panels |
| #F1E8D8 | Row dividers inside admin cards, bar track, nav footer rule |
| #E9E1D2 | Loading skeleton |
| #FFF8EC | Highlighted table row |
| #F1EEE8 | Neutral chip |

**Borders:**

| Hex | Role |
|---|---|
| **#E3D9C8** | **Admin card, sidebar and top-bar borders**; member icon-button and input borders |
| **#E8E0D2** | Member app and dashboard card borders; tab-bar top border |
| **#D9CFBE** | Admin input border |
| #CFC8BA | Toggle off |
| #B9AE99 | Dashed border / faint delta |

**Ink:** #1E1C18 (primary) · #3D3A33 (secondary, notes, idle nav) · #5E5A52 (muted) · #8A8478 (faint, placeholder, inactive tab, empty state).

**Dark and media:** #111111 (Apple Pay/Wallet CTA) · #1C2433 (lock screen) · #F2F2F4 (notification card) · Volunteer-only #16140F / #26231C / #D7A15F / #F4EFE6.

**Scrims:** `rgba(20,18,14,0.5)` admin modal and pay sheet · `0.55` member dialogs · `0.45` drawer.

**Shadows:**

| Where | Value |
|---|---|
| Admin toast | `0 8px 24px rgba(20,18,14,0.25)` |
| PROTOTYPE badge | `0 4px 12px rgba(0,0,0,.2)` |
| Niva FAB | `0 8px 20px rgba(138,70,8,0.35)` |
| Cart bar | `0 8px 20px rgba(47,93,80,0.35)` |
| FAB menu | `0 10px 30px rgba(20,18,14,0.25)` |
| Member drawer | `8px 0 30px rgba(20,18,14,0.2)` |
| GyanPath badge | `0 4px 0 #8A4608` |

Admin cards have **no** shadow.

### 1.3 Spacing and corner radius

**Admin:**
- Top bar: 60px tall, padding `0 20px`, gap 14.
- Sidebar: 220px wide, padding `12px 10px`, item gap 2.
- Content area: padding `22px 28px 40px`, gap 16.
- Card grid: 12 columns, gap 16.
- Card: padding `16px 18px`, gap 12, radius **16**.
- KPI tile: radius 12, padding 12.
- Table header bar: radius 10, padding `8px 10px`. Rows: padding `9px 10px`.
- Inputs: 42px tall, radius 10 (38px / radius 9 in the drawer; 50px / radius 12 on login).
- Modal: radius 22, padding 24, width 480. Toast: radius 14.
- Drawer: 460px wide.

**Member app:**
- Header padding `16px 20px 12px`; content padding `4px 20px 24px`.
- Card: radius 18, padding `14px 16px`. Home "hero" cards: radius 20, padding 16.
- Tab bar: 76px tall.
- Heights: CTA 52 (radius 26) · secondary 48 (radius 26, or 22 inside cards) · pill 44 (radius 20–22) · icon button 44 (radius 22).
- Segmented track: radius 14, padding 4; buttons radius 10.
- Corner radii by count: 14 (78), 18 (68), 20 (51), 12 (42), 22 (33), 26 (31).

### 1.4 Components

**Admin buttons.** One builder defines them all (`btn()`, AdminPortal L468):
`primary: ['#1B2C5C','#FFFFFF','#1B2C5C'], ghost: ['#FFFFFF','#1B2C5C','#1B2C5C'], ok: ['#1F7A4D','#FFFFFF','#1F7A4D'], warn: ['#8A4608','#FFFFFF','#8A4608'], bad: ['#FFFFFF','#B3261E','#B3261E'], off: ['#EDE6DA','#8A8478','#EDE6DA']`

The values are [background, text, border]. "Secondary" is the white `ghost` with a navy outline, and "danger" is the outlined `bad`.

Every button has a 1px border, is fully rounded, and is weight 700. Sizes:

| Where | Height | Radius | Padding | Font |
|---|---|---|---|---|
| Page actions / form buttons | 40 | 20 | `0 16` (`0 18` on form buttons) | 13 |
| Card-header actions | 36 | 18 | `0 14` | 12 |
| Task actions | 34 | 16 | `0 12` | 12 |
| Row actions | 30 | 14 | `0 10` | 12 |
| Modal buttons | 42 | 20 | `0 18` | 13 |
| Login submit | 52 | 26 | | 16 |

**Admin controls:**
- **Filter / chip:** 1px navy border, radius 16, 32–34px tall, padding `0 12px`, 12/700. Selected = navy background with white text; idle = white with navy text.
- **Tag:** white 11/700 text on a solid colour, radius 8, padding `3px 8px`. Colour by module: Refund / QuickBooks #B3261E · Deposits / Bolis / Inventory #8A4608 · Membership / Dashboard #1B2C5C · Pathshala / Content / Feedback / Newsletter #5B4B8A · WhatsApp / Inbox #2F5D50 · Event #7A2E1F · Privacy #5E5A52.
- **Nav item:** radius 10, 40px tall, padding `0 12px`, 14px. Active: background #EEF1F8, text #1B2C5C, weight 800. Idle: transparent, text #3D3A33, weight 600. Count badge: #C9731C, radius 10, 11/700, padding `1px 7px`. Nav footer: 11px #8A8478 with a #F1E8D8 top rule. The nav is one flat list of 14 modules with no section headings.
- **Tabs:** gap 4 with a 1px #E3D9C8 rule under the row. Each tab is 42px tall, padding `0 14px`, 14/700, with a 3px bottom border (navy when active, transparent when idle). Text is navy when active, #5E5A52 when idle.
- **Toggle:** track 44×26, radius 13, #1F7A4D on / #CFC8BA off; white knob 20px (40×24 / 18px in the drawer).
- **Checkbox:** 20px, radius 5, 2px border.
- **Steps:** 4px top border, navy for done or current steps, #E3D9C8 otherwise.
- **Bars:** 14px tall, radius 7, track #F1E8D8.
- **Skeleton:** #E9E1D2, radius 16, `apShim` 1.1s opacity 0.4 → 0.85.
- **Empty state:** plain text, 13px #8A8478, padding `10px 0`. No illustration and no card.
- **Toast:** centred at top 72px. Background #1F7A4D for success, #B3261E for errors. White 14/600, radius 14, padding `12px 18px`, max width 700, shadow as above. Auto-hides after 2.8s.
- **Modal:** scrim `rgba(20,18,14,0.5)`. Card 480px wide, radius 22, padding 24, gap 12. Kicker, then a Fraunces 24/600 title, then body 14px #3D3A33 at line-height 1.55. Buttons at the bottom right: Cancel (outlined navy) and a solid confirm button whose colour depends on the action. An optional code input is 48px tall, radius 12, 20px text, letter-spacing 0.2em.
- **Drawer:** an in-flow right column, 460px, white, #E3D9C8 left border. Header padding `16px 18px` with a #F1E8D8 rule, containing a kicker, a Fraunces 22 title, a 12px subtitle and a 36px round close button (×, #E3D9C8 border). Section titles 12/800 caps. Key-value rows: radius 10, padding `8px 10px`, background #FBF7F0 (clickable rows: white with an #E3D9C8 border). Footer actions sit bottom-right.
- **Login:** two columns, `560px minmax(0,1fr)`.
  - Left: navy panel, padding 56. Tenant mark on a 72px white tile (radius 16), Fraunces 38 title, 16px #C9D1EA copy, audit note at the bottom.
  - Right: padding `56px 72px`. Fraunces 28 "Sign in", inputs 50px / radius 12 / #D9CFBE border / 16px text, 52px navy pill button.
- **Top bar:** mark 36px high · product label (Fraunces 18 navy) · centre-switcher pill (36px tall, radius 18, #FBF7F0 background, #E3D9C8 border, 13/600) · search pill (460×38, radius 19, #F6F2EA, 13px #8A8478 placeholder) · navy avatar (34px, initial 13/700) · name 13/700 and role 11px · "Sign out" as a plain text button (13/600 #5E5A52).

**Member app** (Main, Onboarding, Welcome):
- **Header:** 44px round icon buttons with a 1px #E3D9C8 border and white fill; navy stroke icons, 20px, stroke width 2. The member-card button on the right is a **filled navy** 44px circle with a white QR icon.
  - Home header: centred tenant mark (46px high, natural width) plus a two-line wordmark: "JAIN SOCIETY" Fraunces 17/600, letter-spacing 0.02em; "OF HOUSTON" 11/600 #5E5A52, letter-spacing 0.14em.
  - Other screens: title Fraunces 22/600 navy, left-aligned, flex-grow.
- **Bottom tab bar:** 76px tall, white, 1px #E8E0D2 top border, 8px bottom padding, 5 columns. Icons are 22px inline SVG with stroke width 1.8, and the same outline icon is used in both states. Labels 12/600, gap 4. Active #1B2C5C, idle #8A8478. Icons: house · calendar · heart · **open book** (Jain Way) · people.
- **Icons:** hand-written inline SVGs in Feather/Lucide style (24-unit viewBox, round caps and joins, stroke 1.6–2). There is no icon font.
- **Buttons:**
  - Primary CTA: 52px, radius 26, 16/600, navy (or green / brown / purple / #111111 by context), no border.
  - Secondary: **1px navy border**, white background, navy text, 48px, radius 26 (or 22 at 46px inside cards), 14–15/600.
  - Outlined colour variants use the same shape (green, brown, purple, #B3261E, store).
- **Chips / member pills:** 1px #1B2C5C border, radius 20, 44px, 14/500. Selected = navy with white text; idle = white with navy text.
- **Calendar layer chips:** 1.5px border in the layer colour, radius 18, 40px, 13/600, with a 10px colour dot.
- **Segmented control:** track #F6EFE3, radius 14, padding 4, gap 4. Buttons radius 10, 44px, 14/600. Selected = white with navy text; idle = transparent with #5E5A52 text. The community dashboard variant is different: **selected = navy with white text**, 40px, 13/700.
- **Input:** 48px, radius 12, 1px #E3D9C8 border, 15px, padding `0 12px`. Onboarding sign-in: 52px, radius 14, 16px; the code field is 22px with letter-spacing 0.2em. Labels are 13px **regular** #5E5A52.
- **Cards:** white, 1px #E8E0D2 border, radius 18, padding `14px 16px` (19 instances). Home hero cards: radius 20, padding 16. Tinted callout: #FBEBD7 background, #EFCFA6 border, radius 18, #5E3106 title.
- **Event card:** 88px colour band with a white date chip (radius 10, padding `4px 10px`, 12/600), body padding `12px 16px 16px`.
- **Toast:** position left/right 20, top 76. Background #1F7A4D, radius 14, padding `12px 14px`, 14/600, centred.
- **Confirm dialog:** scrim 0.55, radius 24, padding `22px 20px`, gap 12. Title Fraunces 22/600 **ink**; body 14px #3D3A33 at 1.55. Confirm button 50px / radius 24 / 15/600; Cancel 46px, outlined navy.
- **Drawer:** 304px wide, background #FBF7F0, radius `0 24 24 0`, shadow `8px 0 30px rgba(20,18,14,0.2)`.
  - Header: tenant mark 52px high, 40px round close button, centre name Fraunces 19/600, #E8E0D2 bottom border.
  - Rows: 64px, radius 14, padding `8px 10px`, gap 14. Each has a 44px icon tile (radius 12) with its own tint (#FBEBD7, #EEF1F8, #E4F2EA or #F1EEE8) and a 22px stroke icon, title 16/600, subtitle 12 muted, and a › chevron 18px #8A8478.
- **Niva FAB:** position right 16, bottom 92. 60px tall, radius 30, #8A4608, sparkle icon plus a 15/700 label, brown shadow.
- **Status text** in cards is coloured 13/600 text (#1F7A4D / #8A4608 / #B3261E), not pills. The only solid pill is LIVE: #C0392B, radius 8, padding `3px 8px`, 12/700.

### 1.5 Logo usage
- `assets/jsh-logo.png` is the full lockup (tree plus "JAIN SOCIETY OF HOUSTON"). It appears only on the onboarding welcome screen: 150px wide, centred.
- `assets/jsh-mark.png` (tree only) is used in:
  - the member header (46px) and drawer (52px)
  - notifications (32px on a 38px white tile, radius 9)
  - the admin top bar (36px) and admin login (58px on a 72px white tile, radius 16)
  - the dashboard header (44px)
- The mark is never cropped to a circle.
- The site's `icon-192/512.png` is the mark small on white. The prototype manifest uses `theme_color #1B2C5C` and `background_color #FBF7F0`.

---

## 2. Current apps vs prototype

### 2.1 connect-mobile

**Tokens** (`src/theme.ts`):

| Item | Verdict |
|---|---|
| Colours | **MATCH.** All member-app hexes are present. |
| Missing colours | `#0F1B3D` link hover, `#26396E`, `#D5CBB8`, `#2E5D43`, `#D9731A`, `#F1EEE8`-style tints per drawer item (the `chip` value exists). |
| Fonts | **MATCH.** Fraunces 500/600 and DM Sans 400–700 are loaded via expo-google-fonts in `src/app/_layout.tsx`. |
| Radii / spacing / touch sizes / type scale | **MATCH**, except Welcome hero 34 (theme `hero` is 30) and eyebrow letter-spacing: `0.9` (0.075em) vs **0.72** (0.06em). |
| Shadows | **MISSING.** No shadow tokens (FAB, cart bar, drawer). |

**Components:**

| Component (file) | Prototype | App | Verdict |
|---|---|---|---|
| Icon set (`components/icon.tsx`) | Inline stroke SVGs, 1.8–2 stroke | Ionicons, filled/outline swap | **DIFFERS** |
| Tab bar (`app/(app)/(tabs)/_layout.tsx`) | Icon 22, same outline icon in both states, label 12/600, Jain Way = book | Icon 24, filled when active, label 11, Jain Way = `flower` | **DIFFERS.** Height 76, colours and border MATCH. |
| Header buttons (`components/screen.tsx` AppHeader, `IconButton` in ui.tsx) | 44px circles, white, 1px #E3D9C8 border; member card = filled navy circle | Bare icons, no border or fill | **DIFFERS** |
| Header padding / title | `16 20 12`; title left-aligned | `8 12 8`; title centred | **DIFFERS** |
| Home wordmark (`screen.tsx` Wordmark/CenterMark) | Centred mark 46h + two-line Fraunces/caps wordmark | 36px **circular-cropped** logo or initials + caption caps, left-aligned | **DIFFERS** |
| Button primary (`ui.tsx`) | 52 / r26 / 16/600 | Same | MATCH |
| Button secondary | 1px **#1B2C5C** border | 1.5px **#B8C2DD** border | **DIFFERS** |
| Button md / sm text | 48h → 15/600; 44h → 13–14/600 | 14/600 | DIFFERS (minor) |
| Outlined colour buttons | Green / brown / purple / red / store outlines | Not present (only filled tones) | **MISSING** |
| Chip | Idle white + 1px navy border + navy 14/500, no tick | Idle border #E3D9C8 1.5px + ink2 14/600, shows ✓ | **DIFFERS** |
| Layer chip (coloured border + dot) | 1.5px coloured border, 10px dot | none | **MISSING** |
| Segmented | | | MATCH |
| TextField | Label 13 regular muted; input radius 12, 1px border, 15px | Label 14/600 ink2; radius 10, 1.5px border | **DIFFERS** |
| Card | Padding 14/16 (hero cards 16, radius 20) | Padding 16 all round, radius 18 | DIFFERS (minor) |
| Checkbox | 24–26px, radius 6–7, **navy** 2px border | 26px, radius 8, idle border #B9AE99 | DIFFERS (minor) |
| Toggle | Custom 46×28 track | Native `Switch`, same colours | ACCEPTABLE |
| Pill | Status as coloured text; LIVE = solid radius 8, 12/700 | Tinted, 12/**500** | DIFFERS |
| Toast (`providers/feedback.tsx`) | Radius 14, green/red/navy, padding 12/14 | Radius 14, same colours, padding 12/16 | MATCH (minor padding) |
| Confirm dialog | Title **ink**, body 14 #3D3A33 / 1.55, padding 22/20, Cancel 46h outlined navy | Title navy, body 15, padding 24, Cancel = secondary 52h | **DIFFERS** |
| Drawer (`components/drawer.tsx`) | Right-edge radius 24 + shadow; header with mark + circle close + Fraunces 19 name + divider; 44px tiles tinted per item; › chevron | No radius or shadow, no logo; 40px navyTint tiles; no chevron | **DIFFERS** |
| Welcome (`app/(auth)/welcome.tsx`) | 150px centred logo lockup; "Jai Jinendra" 16 regular muted; Fraunces 34/600 **ink** headline; plain buttons; guest link 14/600, not underlined | 72px circle mark, left-aligned; eyebrow caps brown; hero 30 **navy**; icons on buttons; underlined link | **DIFFERS** |
| Niva FAB | Brown pill, 60px, shadow | Not implemented (feature-flagged `niva:false`) | **MISSING** |
| Tenant logo source | jsh-mark / jsh-logo | `center.branding.logo_url`; the seed has **no** logo_url, so initials show | **MISSING data** |

### 2.2 connect-crm (the future single admin portal)

**Tokens** (`src/app/globals.css` `@theme`). MATCH: navy, saffron, brown, success, maroon, purple, store, ground, card, ink, muted. DIFFERS:

| Token | App | Prototype |
|---|---|---|
| `--color-line` | #e8e0d2 | admin **#E3D9C8** |
| `--color-line-strong` | #d6cab5 | input **#D9CFBE** |
| `--color-subtle` | #f4efe6 | table header / canvas **#F6F2EA** |
| `--color-navy-700` hover | #243a74 | **#0F1B3D** |
| `--color-saffron-50` | #fbf0e3 | **#FBEBD7** |
| `--color-success-50` | #e7f3ec | **#E4F2EA** |
| `--color-maroon-50` | #f6e9e5 | not in the prototype (danger tint **#FBE3E1**) |
| `--color-purple-50` | #efecf6 | **#EFEBF6** |
| Body background | ground #FBF7F0 | admin app **#F6F2EA** |
| Row hover | #fdfbf7 | #FFF8EC for highlighted rows |
| Stat hover | #fffdf9 | not in the prototype |

- MISSING colours: danger **#B3261E** and its tint #FBE3E1, ink-2 #3D3A33, faint #8A8478, #F1E8D8, #E9E1D2, #EDE6DA, #C9D1EA, gold, toggle-off.
- Fonts: Fraunces and DM Sans load through next/font. **MATCH**, but check that the opsz axis is enabled. JetBrains Mono is not loaded; tables use `ui-monospace`. That is optional, because the prototype does not render it.

**Components:**

| Component (file) | Prototype | App | Verdict |
|---|---|---|---|
| Shell (`components/shell/app-shell.tsx`) | White 60px top bar + white 220px sidebar with #E3D9C8 borders | **Navy** 256px sidebar with section headings; top bar is translucent ground | **DIFFERS (major)** |
| Sidebar label | Mark 36px + Fraunces 18 navy | "Connect CRM / System of record" | DIFFERS |
| Search / centre switcher in top bar | Search pill + centre-switcher pill | none | **MISSING** |
| Nav item (`shell/nav-link.tsx`) | #EEF1F8 / navy / 800 active; #3D3A33 / 600 idle; radius 10, 40h, 14px; saffron count badge | white/15 on navy; radius 8, 44h, 15/500 | **DIFFERS** |
| User (`shell/user-menu.tsx`) | 34px navy avatar + name 13/700 + role 11 + text "Sign out" | Dropdown with 32px avatar | DIFFERS |
| PageHeader (`components/ui.tsx`) | Fraunces 28 / 600 / **ink**, subtitle 13 | 3xl (30) navy, tracking-tight, description 15 | **DIFFERS** |
| Card | Radius **16**, padding 16/18, gap 12, title **DM Sans 16/700**, hint 12, no header divider, no shadow, border #E3D9C8 | Radius 12, Fraunces lg title, border-b header, padding 20, shadow | **DIFFERS** |
| Stat / KPI | Tile on #FBF7F0, radius 12, padding 12; label 12/600; value **DM Sans 24/800 coloured**; sub 11 | White card, coloured 4px top border, Fraunces 30 ink | **DIFFERS** |
| buttonClass | Pill (radius 20), 40h, 13/**700**, 1px border; variants primary / ghost(outline navy) / ok / warn / bad(outline red) / off | Radius 8, 44h, 14/600; secondary = grey border + ink text; danger = maroon outline | **DIFFERS** |
| Badge | Tag = solid colour, white 11/700, radius 8; status in tables = bold coloured text | Rounded-full tinted pill with border, 12/600 | **DIFFERS** |
| Tabs | 3px underline, 14/**700**, 42h, gap 4 | 2px underline, 14/600, 44h | DIFFERS (minor) |
| `.crm-table` (globals.css) | Header is a rounded (10) #F6F2EA bar, 11/700, letter-spacing .04em, caps; rows 13px, padding 9/10, #F1E8D8 dividers | 12px uppercase, letter-spacing .02em, #f4efe6, square; rows 14px, #e8e0d2 | DIFFERS |
| `.crm-input` | 42h, radius **10**, border #D9CFBE, 14px | 44h, radius 8, border #d6cab5, 15px | DIFFERS |
| `.crm-label` | 12/700 **muted** | 13/600 ink | DIFFERS |
| Chips / filters, toggle, checkbox groups, steps, bars | as prototype | none (native checkboxes) | **MISSING** |
| Toast | as prototype | none (inline success/error `<p>` in `components/action-form.tsx`) | **MISSING** |
| Modal (step-up / confirm) | as prototype | none (two-person uses `<details>`) | **MISSING** |
| Right-hand detail drawer | as prototype | none (full pages) | **MISSING** |
| Skeleton loading | as prototype | none | **MISSING** |
| EmptyState | Plain 13px #8A8478 text | Centred bold title + text | DIFFERS |
| Alert | n/a in prototype; tints should use #FBE3E1 / #B3261E | Uses maroon | DIFFERS |
| Login (`app/login/page.tsx`) | Split navy panel (560px) + form | Centred card, "Connect / Connect CRM" | **DIFFERS** |
| Public Community Dashboard | Exists in the prototype | not built in any app | **MISSING** |

### 2.3 connect-admin (being merged into connect-crm)
- Same basic tokens with different names: `navy-deep #13204a`, `navy-soft`, `sand #f4efe6`, `danger #b3261e` (correct), `danger-soft #fbeae8` (should be #FBE3E1), `warning-soft #fbf1e4` (should be #FBEBD7), `maroon-soft #f6ebe7`, `purple-soft #efecf6` (should be #EFEBF6).
- Off-palette colours hard-coded in code: `#FBF6DC` / `#6B5A00` ("caution" badge), `#13204a`, `#f7b4ae`, `#9fe0bc`. The ops mode uses Volunteer.dc.html colours (`#D7A15F`, `#1E1508`); that prototype is marked deprecated.
- Structure has the same problems as connect-crm: navy sidebar, square `btn` utilities (radius 8, 44h, 14/600), `btn-secondary` with a #E8E0D2 border, and Card with radius 12 and a Fraunces title.
- The header is navy on mobile and white on desktop, with the centre name and a "Sign out" button.
- `public/` still holds create-next-app boilerplate (`next.svg`, `vercel.svg`, `file.svg`, `globe.svg`, `window.svg`).
- The favicon is the default Next.js icon; `src/app/favicon.ico` has the same md5 in both portals.

---

## 3. Token files to adopt

### 3.1 Portal: `connect-crm/src/app/globals.css` (connect-admin should import the same file until the merge)

```css
@import "tailwindcss";

/* Community Connect — admin portal tokens. Exact values from
   docs/handoff/prototypes/source/AdminPortal.dc.html. Tenant branding
   (centers.branding) may override --color-navy / --color-saffron at runtime. */
@theme {
  /* Brand */
  --color-navy: #1B2C5C;
  --color-navy-hover: #0F1B3D;
  --color-navy-50: #EEF1F8;     /* active nav, selected row/persona, info tint */
  --color-navy-100: #E6E9F3;
  --color-navy-200: #C9D1EA;    /* text on navy */
  --color-navy-300: #B8C2DD;
  --color-navy-400: #8A93AE;    /* disabled navy */
  --color-navy-800: #26396E;
  --color-navy-700: #33467A;
  --color-saffron: #C9731C;     /* nav count badge, progress, accent */
  --color-saffron-50: #FBEBD7;
  --color-saffron-200: #EFCFA6;
  --color-gold: #F2B632;
  --color-brown: #8A4608;       /* warn button, kickers, money */
  --color-brown-900: #5E3106;
  --color-success: #1F7A4D;     /* ok button, toggle on, success toast */
  --color-success-900: #14502F;
  --color-success-50: #E4F2EA;
  --color-success-200: #B7DCC6;
  --color-success-on-navy: #7FD1A4;
  --color-danger: #B3261E;      /* bad button, errors, refund tags, error toast */
  --color-danger-50: #FBE3E1;
  --color-live: #C0392B;
  --color-maroon: #7A2E1F;      /* events */
  --color-purple: #5B4B8A;      /* pathshala, content, feedback */
  --color-purple-50: #EFEBF6;
  --color-purple-900: #3D2F63;
  --color-store: #2F5D50;       /* store, whatsapp, inbox */
  --color-store-50: #E8F1ED;

  /* Surfaces */
  --color-frame: #EDE6DA;       /* 'off' button bg */
  --color-canvas: #F6F2EA;      /* app background, table header, search, read-only field */
  --color-ground: #FBF7F0;      /* KPI tile, kv row, check group, public dashboard bg */
  --color-card: #FFFFFF;
  --color-highlight: #FFF8EC;   /* highlighted table row */
  --color-skeleton: #E9E1D2;
  --color-track: #F1E8D8;       /* bar track, row divider, nav-foot rule */

  /* Lines */
  --color-line: #E3D9C8;        /* cards, top bar, sidebar, tabs rule */
  --color-line-soft: #F1E8D8;   /* dividers inside cards/drawer */
  --color-line-public: #E8E0D2; /* public dashboard + member app cards */
  --color-line-input: #D9CFBE;
  --color-toggle-off: #CFC8BA;

  /* Ink */
  --color-ink: #1E1C18;
  --color-ink-2: #3D3A33;
  --color-muted: #5E5A52;
  --color-faint: #8A8478;
  --color-faint-2: #B9AE99;

  /* Type */
  --font-display: var(--font-fraunces), Georgia, serif;
  --font-sans: var(--font-dm-sans), system-ui, sans-serif;
  --font-mono: var(--font-jetbrains-mono), ui-monospace, monospace;
  --tracking-kicker: 0.06em;
  --tracking-label: 0.04em;

  /* Radii */
  --radius-chip: 8px;   /* tags */
  --radius-field: 10px; /* inputs, nav items, table header bar, kv rows */
  --radius-tile: 12px;  /* KPI tiles, preview, check groups */
  --radius-toast: 14px;
  --radius-card: 16px;
  --radius-modal: 22px;
  --radius-pill: 9999px;

  /* Shadows (cards have none) */
  --shadow-toast: 0 8px 24px rgba(20, 18, 14, 0.25);
  --shadow-menu: 0 10px 30px rgba(20, 18, 14, 0.25);
  --shadow-sheet: 8px 0 30px rgba(20, 18, 14, 0.2);

  --animate-shimmer: cc-shim 1.1s infinite;
  @keyframes cc-shim { 0%, 100% { opacity: .4 } 50% { opacity: .85 } }
}

html { color-scheme: light; }
body { background: var(--color-canvas); color: var(--color-ink); font-family: var(--font-sans); }
a { color: var(--color-navy); } a:hover { color: var(--color-navy-hover); }
:focus-visible { outline: 2px solid var(--color-navy); outline-offset: 2px; }

@layer components {
  /* Shell */
  .cc-topbar  { height: 60px; display: flex; align-items: center; gap: 14px; padding: 0 20px; background: #fff; border-bottom: 1px solid var(--color-line); }
  .cc-product { font-family: var(--font-display); font-size: 18px; font-weight: 600; color: var(--color-navy); }
  .cc-center-pill { min-height: 36px; padding: 0 12px; border-radius: 18px; border: 1px solid var(--color-line); background: var(--color-ground); font-size: 13px; font-weight: 600; }
  .cc-search  { width: 460px; min-height: 38px; border-radius: 19px; background: var(--color-canvas); border: 1px solid var(--color-line); padding: 0 14px; font-size: 13px; color: var(--color-faint); }
  .cc-avatar  { width: 34px; height: 34px; border-radius: 17px; background: var(--color-navy); color: #fff; font-size: 13px; font-weight: 700; display: grid; place-items: center; }
  .cc-sidebar { width: 220px; background: #fff; border-right: 1px solid var(--color-line); padding: 12px 10px; display: flex; flex-direction: column; gap: 2px; }
  .cc-nav     { min-height: 40px; padding: 0 12px; border-radius: 10px; display: flex; align-items: center; justify-content: space-between; font-size: 14px; font-weight: 600; color: var(--color-ink-2); }
  .cc-nav[aria-current="page"] { background: var(--color-navy-50); color: var(--color-navy); font-weight: 800; }
  .cc-nav-badge { background: var(--color-saffron); color: #fff; border-radius: 10px; font-size: 11px; font-weight: 700; padding: 1px 7px; }
  .cc-nav-foot  { font-size: 11px; line-height: 1.5; color: var(--color-faint); padding: 10px 8px; border-top: 1px solid var(--color-line-soft); }
  .cc-main    { padding: 22px 28px 40px; display: flex; flex-direction: column; gap: 16px; }

  /* Type */
  .cc-page-title { font-family: var(--font-display); font-size: 28px; font-weight: 600; color: var(--color-ink); }
  .cc-page-sub   { font-size: 13px; color: var(--color-muted); }
  .cc-kicker     { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--color-brown); }
  .cc-section    { font-size: 12px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; color: var(--color-muted); }

  /* Card + KPI */
  .cc-card       { background: #fff; border: 1px solid var(--color-line); border-radius: 16px; padding: 16px 18px; display: flex; flex-direction: column; gap: 12px; min-width: 0; }
  .cc-card-title { font-size: 16px; font-weight: 700; }
  .cc-card-hint  { font-size: 12px; color: var(--color-muted); }
  .cc-kpi        { background: var(--color-ground); border-radius: 12px; padding: 12px; }
  .cc-kpi-label  { font-size: 12px; font-weight: 600; color: var(--color-muted); }
  .cc-kpi-value  { font-size: 24px; font-weight: 800; }            /* colour per metric */
  .cc-kpi-sub    { font-size: 11px; color: var(--color-muted); }

  /* Buttons: btn() in the prototype */
  .cc-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; border: 1px solid; border-radius: 20px; min-height: 40px; padding: 0 16px; font-size: 13px; font-weight: 700; white-space: nowrap; }
  .cc-btn-lg { min-height: 52px; border-radius: 26px; font-size: 16px; padding: 0 22px; }
  .cc-btn-sm { min-height: 36px; border-radius: 18px; padding: 0 14px; font-size: 12px; }
  .cc-btn-xs { min-height: 30px; border-radius: 14px; padding: 0 10px; font-size: 12px; }
  .cc-btn-primary { background: var(--color-navy);    color: #fff;                 border-color: var(--color-navy); }
  .cc-btn-ghost   { background: #fff;                  color: var(--color-navy);    border-color: var(--color-navy); }
  .cc-btn-ok      { background: var(--color-success); color: #fff;                 border-color: var(--color-success); }
  .cc-btn-warn    { background: var(--color-brown);   color: #fff;                 border-color: var(--color-brown); }
  .cc-btn-bad     { background: #fff;                  color: var(--color-danger);  border-color: var(--color-danger); }
  .cc-btn-off, .cc-btn:disabled { background: var(--color-frame); color: var(--color-faint); border-color: var(--color-frame); cursor: not-allowed; }

  /* Chips, tags, tabs */
  .cc-chip { border: 1px solid var(--color-navy); background: #fff; color: var(--color-navy); border-radius: 16px; min-height: 34px; padding: 0 12px; font-size: 12px; font-weight: 700; }
  .cc-chip[aria-pressed="true"] { background: var(--color-navy); color: #fff; }
  .cc-tag  { font-size: 11px; font-weight: 700; color: #fff; border-radius: 8px; padding: 3px 8px; white-space: nowrap; } /* bg = module colour */
  .cc-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--color-line); }
  .cc-tab  { min-height: 42px; padding: 0 14px; font-size: 14px; font-weight: 700; color: var(--color-muted); border-bottom: 3px solid transparent; }
  .cc-tab[aria-current="page"] { color: var(--color-navy); border-bottom-color: var(--color-navy); }

  /* Table */
  .cc-thead { display: grid; gap: 10px; padding: 8px 10px; background: var(--color-canvas); border-radius: 10px; font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--color-muted); }
  .cc-row   { display: grid; gap: 10px; padding: 9px 10px; border-bottom: 1px solid var(--color-line-soft); align-items: center; font-size: 13px; }
  .cc-row[data-highlight] { background: var(--color-highlight); }
  .cc-status-ok { color: var(--color-success); font-weight: 700; } .cc-status-warn { color: var(--color-brown); font-weight: 700; } .cc-status-bad { color: var(--color-danger); font-weight: 700; }

  /* Forms */
  .cc-label { font-size: 12px; font-weight: 700; color: var(--color-muted); }
  .cc-input { min-height: 42px; border-radius: 10px; border: 1px solid var(--color-line-input); background: #fff; padding: 0 12px; font-size: 14px; color: var(--color-ink); }
  .cc-input-info { min-height: 42px; border-radius: 10px; background: var(--color-canvas); padding: 10px 12px; font-size: 14px; }
  .cc-toggle { width: 44px; height: 26px; border-radius: 13px; background: var(--color-toggle-off); padding: 0 3px; display: flex; align-items: center; }
  .cc-toggle[aria-checked="true"] { background: var(--color-success); justify-content: flex-end; }
  .cc-toggle > span { width: 20px; height: 20px; border-radius: 10px; background: #fff; }
  .cc-check { width: 20px; height: 20px; border-radius: 5px; border: 2px solid var(--color-navy); }

  /* Feedback */
  .cc-toast { position: fixed; left: 50%; top: 72px; transform: translateX(-50%); background: var(--color-success); color: #fff; border-radius: 14px; padding: 12px 18px; font-size: 14px; font-weight: 600; box-shadow: var(--shadow-toast); max-width: 700px; }
  .cc-toast[data-tone="bad"] { background: var(--color-danger); }
  .cc-scrim { position: fixed; inset: 0; background: rgba(20, 18, 14, .5); display: grid; place-items: center; }
  .cc-modal { width: 480px; background: #fff; border-radius: 22px; padding: 24px; display: flex; flex-direction: column; gap: 12px; }
  .cc-modal-title { font-family: var(--font-display); font-size: 24px; font-weight: 600; }
  .cc-modal-body  { font-size: 14px; line-height: 1.55; color: var(--color-ink-2); }
  .cc-drawer { width: 460px; background: #fff; border-left: 1px solid var(--color-line); display: flex; flex-direction: column; }
  .cc-drawer-head  { padding: 16px 18px; border-bottom: 1px solid var(--color-line-soft); }
  .cc-drawer-title { font-family: var(--font-display); font-size: 22px; font-weight: 600; }
  .cc-kv { border-radius: 10px; padding: 8px 10px; background: var(--color-ground); display: flex; justify-content: space-between; gap: 10px; font-size: 13px; }
  .cc-skeleton { background: var(--color-skeleton); border-radius: 16px; animation: var(--animate-shimmer); }
  .cc-empty { font-size: 13px; color: var(--color-faint); padding: 14px 10px; }
}
```

**Aliases during the merge.** Map old token names to new ones, then delete the old names:

| Old name | New name |
|---|---|
| `subtle`, `sand` | `canvas` |
| `line-strong` | `line-input` |
| `navy-700`, `navy-deep` | `navy-hover` |
| `navy-soft` | `navy-50` |
| `maroon-50`, `maroon-soft`, `danger-soft` | `danger-50` (and switch error UIs from `maroon` to `danger`) |
| `warning`, `warning-soft` | `brown`, `saffron-50` |
| `success-soft` | `success-50` |
| `purple-soft` | `purple-50` |

In `layout.tsx`:
- Load `Fraunces({ variable: '--font-fraunces', subsets: ['latin'], axes: ['opsz'] })`, `DM_Sans({ variable: '--font-dm-sans', subsets: ['latin'] })`, and optionally `JetBrains_Mono({ variable: '--font-jetbrains-mono' })` for IDs.
- Set `viewport.themeColor '#1B2C5C'`.

### 3.2 Mobile: replace `connect-mobile/src/theme.ts`
Existing names are kept so screens compile; new tokens are marked `// NEW` and changed ones `// CHANGED`.

```ts
export const colors = {
  ground: '#FBF7F0', frame: '#EDE6DA', card: '#FFFFFF', panel: '#F6EFE3',
  divider: '#F1E8D8', dividerLight: '#F4EEE3', chip: '#F1EEE8',
  border: '#E8E0D2', borderInput: '#E3D9C8', dashed: '#B9AE99', dashed2: '#D5CBB8', // NEW dashed2
  toggleOff: '#CFC8BA', starEmpty: '#E3DCCF',
  ink: '#1E1C18', ink2: '#3D3A33', muted: '#5E5A52', faint: '#8A8478',
  navy: '#1B2C5C', navyHover: '#0F1B3D', /* NEW */ navyTint: '#EEF1F8', navyTint2: '#E6E9F3',
  navyBorder: '#B8C2DD', onNavy: '#C9D1EA', navyPanel: '#33467A', navyPanel2: '#26396E', /* NEW */ navyDisabled: '#8A93AE',
  brown: '#8A4608', brownDark: '#5E3106', brownText: '#5E4A33', brownTint: '#FBEBD7', brownBorder: '#EFCFA6', onBrown: '#F6DDBF',
  saffron: '#C9731C', flame: '#F2A03D', flame2: '#D9731A', /* NEW */ badge: '#E8892A', gold: '#F2B632',
  green: '#1F7A4D', greenDark: '#14502F', greenDark2: '#2E5D43', /* NEW */ greenTint: '#E4F2EA', greenBorder: '#B7DCC6', onNavyGreen: '#7FD1A4',
  store: '#2F5D50', storeLight: '#3E7566', onStore: '#CFE6DC', storeTint: '#E8F1ED',
  danger: '#B3261E', dangerTint: '#FBE3E1', live: '#C0392B',
  maroon: '#7A2E1F', maroonButton: '#8F4232', onMaroon: '#F3D6CF',
  purple: '#5B4B8A', purpleTint: '#EFEBF6', onPurple: '#DCD6EC', purpleBorder: '#D8CFEA', purpleBg: '#F5F2FA', purpleDark: '#3D2F63', album: '#4B3A66', // NEW album
  black: '#111111', white: '#FFFFFF', lock: '#1C2433', lockText: '#D6DCE8', lockMeta: '#9AA4B8', notif: '#F2F2F4', // NEW lock/notif
  scrim: 'rgba(20,18,14,0.55)', scrimSheet: 'rgba(20,18,14,0.5)', /* NEW */ scrimLight: 'rgba(20,18,14,0.45)',
} as const;

export const fonts = { display: 'Fraunces_500Medium', displayBold: 'Fraunces_600SemiBold',
  body: 'DMSans_400Regular', bodyMedium: 'DMSans_500Medium', bodySemi: 'DMSans_600SemiBold', bodyBold: 'DMSans_700Bold' } as const;

export const radii = { xs: 6, check: 7, /* NEW */ sm: 8, md: 10, lg: 12, card: 14, row: 16, xl: 18, xxl: 20, pill: 22,
  sheet: 24, cta: 26, cart: 28, fab: 30, round: 999 } as const;   // NEW cart, fab

export const space = { xxs: 4, xs: 6, sm: 8, md: 12, cardX: 16, cardY: 14, /* NEW */ lg: 16, gutter: 20, xl: 24, xxl: 32 } as const;
export const touch = { min: 44, secondary: 48, cta: 52, row: 56, fab: 60, drawerRow: 64 } as const; // NEW fab, drawerRow

export const type = { clock: 84, onboardingHero: 34, /* NEW */ pledgeAmount: 32, hero: 30, display: 26, title: 22, headline: 19,
  subhead: 18, cardTitle: 17, section: 16, body: 15, bodySmall: 14, meta: 13, caption: 12, fine: 11, badge: 10, tithi: 9 } as const;

/** letter-spacing in px at the size used (em × size). */
export const tracking = { eyebrow: 0.72 /* CHANGED from 0.9 = 0.06em@12 */, label: 0.48, badge: 0.8,
  wordmark: 0.34 /* 0.02em@17 */, wordmarkSub: 1.54 /* 0.14em@11 */, code: 0.2 /* em, ×fontSize */ } as const;

export const shadows = { // NEW (RN: shadowColor/Offset/Opacity/Radius + elevation)
  fab:    { shadowColor: '#8A4608', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.35, shadowRadius: 10, elevation: 8 },
  cart:   { shadowColor: '#2F5D50', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.35, shadowRadius: 10, elevation: 8 },
  menu:   { shadowColor: '#14120E', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.25, shadowRadius: 15, elevation: 10 },
  drawer: { shadowColor: '#14120E', shadowOffset: { width: 8, height: 0 }, shadowOpacity: 0.2, shadowRadius: 15, elevation: 16 },
} as const;

/** Component specs lifted from Main.dc.html. */
export const components = { // NEW
  header:   { padTop: 16, padX: 20, padBottom: 12, gap: 12, iconButton: 44, iconSize: 20, iconStroke: 2, border: '#E3D9C8', markHeight: 46 },
  tabBar:   { height: 76, padBottom: 8, iconSize: 22, iconStroke: 1.8, labelSize: 12, gap: 4, active: '#1B2C5C', inactive: '#8A8478', border: '#E8E0D2' },
  button:   { borderWidth: 1, cta: { h: 52, r: 26, size: 16 }, secondary: { h: 48, r: 26, size: 15 }, inCard: { h: 46, r: 22, size: 14 }, pill: { h: 44, r: 20, size: 13 } },
  chip:     { h: 44, r: 20, size: 14, weight: '500', border: '#1B2C5C' },
  layerChip:{ h: 40, r: 18, size: 13, borderWidth: 1.5, dot: 10 },
  input:    { h: 48, r: 12, size: 15, borderWidth: 1, labelSize: 13, labelColor: '#5E5A52' },
  signInInput: { h: 52, r: 14, size: 16 },
  card:     { r: 18, padY: 14, padX: 16, hero: { r: 20, pad: 16 } },
  segmented:{ trackR: 14, trackPad: 4, gap: 4, itemR: 10, h: 44, size: 14 },
  toggle:   { w: 46, h: 28, knob: 22 },
  checkbox: { size: 24, r: 6, borderWidth: 2, border: '#1B2C5C' },
  toast:    { top: 76, x: 20, r: 14, padY: 12, padX: 14, size: 14 },
  dialog:   { r: 24, padY: 22, padX: 20, gap: 12, titleSize: 22, bodySize: 14, bodyLine: 1.55 },
  drawer:   { width: 304, edgeR: 24, markHeight: 52, nameSize: 19, rowH: 64, rowR: 14, tile: 44, tileR: 12, iconSize: 22 },
  fab:      { h: 60, r: 30, right: 16, bottom: 92, bg: '#8A4608', size: 15 },
} as const;

export const textScales = { standard: 1, large: 1.15, largest: 1.3 } as const;
export const layout = { maxContentWidth: 640, tabBarHeight: 76 } as const;
```

---

## 4. Component changes needed (by file)

### connect-mobile
1. `src/components/icon.tsx`: replace Ionicons with the prototype's stroke icons. Use `lucide-react-native` (it builds on `react-native-svg`, which is already installed), or port the prototype's own SVG paths (Main L1322–1327 tab icons, L25/28/37 header icons, the drawer icons, and the Niva sparkle). Stroke 1.8 for tab/drawer icons, 2 for header icons.
2. `src/app/(app)/(tabs)/_layout.tsx`:
   - icon size 22, the same outline icon for both states
   - label font size 12, weight 600
   - Jain Way icon = open book (not `flower`)
   - `paddingBottom: 8` plus the safe-area inset
3. `src/components/screen.tsx`:
   - AppHeader padding `16/20/12`, gap 12.
   - Menu and back buttons: 44px circles, white fill, 1px `#E3D9C8` border.
   - Member-card button: filled navy circle with a white QR icon.
   - Title left-aligned.
   - `Wordmark`: centred tenant mark (`contentFit="contain"`, height 46, **no circular crop**) plus the two-line Fraunces/caps name.
   - `CenterMark`: stop the `borderRadius: size/2` crop and fall back to initials only when there is no logo.
4. `src/components/ui.tsx`:
   - `Button` secondary → 1px `#1B2C5C` border.
   - Add outlined tones for green, brown, purple, danger and store.
   - Button text sizes: md 15/600; sm 13–14/600.
   - `Chip`: idle = white with 1px navy border and navy 14/500 text; remove the checkmark.
   - Add a `LayerChip` (coloured border plus dot).
   - `TextField`: label 13 regular muted; input radius 12, border 1, font size 15.
   - `Card`: padding 14/16; add a `hero` variant (radius 20, padding 16).
   - `Checkbox`: radius 6, navy border.
   - `Pill`: weight 600/700; add a solid variant.
   - `SectionTitle`: letter-spacing 0.72, padding `4 4 0`.
   - `Txt` eyebrow tracking: 0.72.
5. `src/providers/feedback.tsx`:
   - Confirm dialog: title colour `ink`, body 14 `ink2` at line-height ~22, padding 22/20, confirm button 50h radius 24, Cancel 46h outlined navy.
   - Toast: horizontal padding 14.
6. `src/components/drawer.tsx`:
   - Panel: right-edge radius 24, drawer shadow.
   - Header: 52px tenant mark, 40px bordered round close button, Fraunces 19/600 ink name, `#E8E0D2` bottom rule.
   - Rows: radius 14, 44px icon tiles with a tint per item, 16/600 titles, › chevron.
7. `src/app/(auth)/welcome.tsx`:
   - full tenant lockup (`branding.logo_url`), 150px wide, centred
   - "Jai Jinendra" as 16px muted body text
   - headline Fraunces 34/600 ink, line-height 1.15
   - buttons without icons
   - guest link 14/600 navy, no underline
8. Niva FAB (`src/app/(app)/(tabs)/_layout.tsx` or `src/features/home.tsx`) behind `feature_flags.niva`. Cart bar with the store shadow in `store.tsx`.
9. `supabase/seed.sql` (connect-crm): add `"logo_url"` (lockup) and `"mark_url"` (tree mark) to JSH `branding`. Mobile currently shows "JSH" initials.

### connect-crm (single admin portal)
1. `src/app/globals.css`: the token block in §3.1. Rewrite `.crm-table`, `.crm-input` and `.crm-label` to the `.cc-*` specs.
2. `src/components/shell/app-shell.tsx`:
   - Rebuild to the prototype layout: 60px white top bar with tenant mark, product name, centre switcher, search, avatar/name/role and Sign out.
   - 220px white sidebar with a flat nav list, a count badge on Home, and a role/entitlements footer note.
   - `bg-canvas` main area with padding `22px 28px 40px`.
   - Keep a mobile menu toggle.
3. `src/components/shell/nav-link.tsx`: `.cc-nav` states.
4. `src/components/shell/user-menu.tsx`: inline avatar (34px) + name + role, with a text "Sign out".
5. `src/components/ui.tsx`:
   - `PageHeader` → `.cc-page-title` (ink, 28) and `.cc-page-sub`.
   - `Card` → radius 16, padding 16/18, DM Sans 16/700 title, 12px hint, no divider or shadow.
   - `Stat` → `.cc-kpi` tiles inside a card.
   - `Badge` → `.cc-tag` (solid) plus a new `StatusText` (ok / warn / bad bold text).
   - `Tabs` → 3px underline, weight 700, 42h.
   - `buttonClass` → pill `.cc-btn-*` (primary / ghost / ok / warn / bad / off).
   - `EmptyState` → 13px faint text.
   - `Alert` → danger `#B3261E` / `#FBE3E1`.
   - `Field` label → 12/700 muted.
6. New components:
   - `Toast` (replaces the inline success `<p>` in `action-form.tsx`)
   - `Modal` (step-up code and two-person confirm; replaces the `<details>` in `two-person-controls.tsx`)
   - `Drawer` (household/person/pledge quick view)
   - `Chips`, `Toggle`, `CheckGroup`, `Steps`, `Bars`, `Skeleton`
7. `src/app/login/page.tsx`: split layout (560px navy panel with the tenant mark on a white tile, Fraunces 38 hero, `#C9D1EA` copy; 400px form with a 52px pill button).
8. `src/app/layout.tsx`: fonts (opsz, optional mono), metadata and icons (§5).
9. Public Community Dashboard route (CommunityDashboard.dc.html): not built anywhere.

### connect-admin
- Moving into connect-crm, so do not restyle it separately. Until the merge: point `globals.css` at the shared tokens.
- Remove the off-palette colours: `#FBF6DC`, `#6B5A00`, `#13204a`, `#fbeae8`, `#fbf1e4`, `#f6ebe7`, `#f7b4ae`, `#9fe0bc`.
- Replace the square `btn`/`btn-*` utilities with `.cc-btn-*`.
- Move `(console)/layout.tsx` and `components/nav.tsx` to the shared shell.
- The ops pages follow the deprecated Volunteer prototype (`#D7A15F`, `#1E1508`); that needs a decision once the new Ops prototype exists.

---

## 5. Product brand strings and assets → "Community Connect"
**Rule:** the product brand is "Community Connect". The tenant (JSH / Jain Society of Houston and its logo) stays wherever the prototype shows the community: the member-app header, drawer, onboarding lockup, "Today at {center}", "Ask {center} Niva", the "New to {center}" guide, the centre-switcher pill, and dashboard content.

**Decision for the owner:** the prototype's product label slot reads "JSH Admin" / "JSH Admin Portal" (AdminPortal L27, L59). My recommendation:
- Top bar: tenant mark + "Community Connect".
- Login hero: "Community Connect", with "Admin portal" underneath and the tenant mark on the white tile.

### connect-mobile

| Location | Current | Change to |
|---|---|---|
| `app.json` `expo.name` | `"Connect"` | `"Community Connect"` (home-screen label; iOS may truncate, so consider `ios.infoPlist.CFBundleDisplayName`) |
| `app.json` `slug` / `scheme` | `connect-mobile` / `connect` | Optional `community-connect`. The scheme change affects deep links and auth redirects. |
| `app.json` bundle/package | `org.connectplatform.member` | Store identity; change only before first store submission |
| `app.json` camera / Face ID permission text | "Allow Connect to …" | "Allow Community Connect to …" |
| `app.json` `icon`, `ios.icon` (`assets/expo.icon` = Expo blue gradient), android adaptive fg/bg/mono, `web.favicon`, splash image | **Expo template placeholders.** The splash is a white Expo chevron on `#FBF7F0`, which is invisible. | New Community Connect app icon and splash. For a tenant-branded build, the JSH mark per the prototype manifest. Splash background `#FBF7F0`, dark `#1B2C5C`. |
| `dist/index.html` `<title>` | `Connect` | Regenerated from `expo.name` |
| `src/i18n/en.ts` (also add gu/hi translations) | `drawer.version` 'Connect · version {version}'; `setup.title`; `lock.body`; `bolis.reminderUnavailable`; `settings.biometricSub`; `settings.aboutSub`; `scan.cameraDenied` | "Community Connect …" |
| `src/lib/push.ts` L29, L35, L40 | Android channel name `'Connect'` and two messages | "Community Connect" |
| `src/lib/api/family.ts` L217 | "Sent from the Connect member app." | "Sent from the Community Connect app." |
| `src/app/(app)/(tabs)/family.tsx` L46 | `Connect ${household_number}` | "Community Connect no. …" or a neutral "Household no. …" |
| Prototype drawer item "Pathshala Connect" | Product-like name | Confirm with the owner, e.g. "Pathshala" |

### connect-crm

| Location | Current | Change to |
|---|---|---|
| `src/app/layout.tsx` metadata | `"Connect CRM"`, template `"%s · Connect CRM"` | "Community Connect", `"%s · Community Connect"` |
| `src/app/favicon.ico` | Default create-next-app icon | Product icon; add `icon.png`/`apple-icon.png` |
| `public/` | Empty | Manifest / icons |
| `src/components/shell/app-shell.tsx` L39–40 | "Connect CRM / System of record" | Tenant mark + "Community Connect" |
| `src/app/login/page.tsx` L25–33 | "Connect" eyebrow, "Connect CRM" title, "email on their Connect account" | Community Connect |
| `src/app/login/login-form.tsx` L16 | "No Connect account uses this email…" | Community Connect |
| `src/components/setup-screen.tsx` L8, L10, L43 | "Connect CRM needs to be configured", "Connect Supabase project" | Community Connect |
| `src/app/(app)/layout.tsx` L28 | "Connect CRM could not start" | Community Connect |
| `src/lib/session.ts` L143 | "Connect CRM is not configured yet" | Community Connect |
| `src/app/(app)/settings/roles/actions.ts` L91; `settings/roles/grant-form.tsx` L123 | "signed in to Connect" | Community Connect |
| Identifier labels: `lib/identifiers.ts` L13/15, `components/identifiers-panel.tsx` L73, `components/household-card.tsx` L63, `households/page.tsx` L42/284, `households/[id]/identifiers-tab.tsx` L62–63, `households/[id]/page.tsx` L119, `households/[id]/members-tab.tsx` L57, `people/[id]/page.tsx` L97/217 | "Connect member/household number", "Connect no." | Decide between "Community Connect member no." and neutral "Member no." / "Household no." (members see these numbers) |
| `households/page.tsx` L164, `components/household-picker.tsx` L80 | Hard-coded `JSH-H-2041` / `JSH-H-…` in placeholders | Tenant config, per the handoff rule "never hard-code JSH specifics" |
| `supabase/templates/otp_code.html` | "Your Connect sign-in code" (plain HTML, no logo or colours) | "Your Community Connect sign-in code", styled with navy/ivory and Fraunces heading fallbacks |
| `supabase/config.toml` L39, L43 | Subject "Your Connect sign-in code" | Community Connect |
| `supabase/seed.sql` JSH `branding` | Colours and fonts only | Add `logo_url` and `mark_url` |

### connect-admin (strings move with the merge)

| Location | Current |
|---|---|
| `src/app/layout.tsx` | "Connect Admin" title/template; `themeColor #1B2C5C` is correct |
| `src/app/favicon.ico` | Default Next icon |
| `public/*.svg` | Next boilerplate, delete |
| `(console)/layout.tsx` L18, L36 | "Connect Admin" |
| `login/page.tsx` L19; `setup/page.tsx` L19 | "Connect Admin" eyebrow |
| `components/ui.tsx` L133 | "this part of Connect Admin" |
| `(console)/no-access/page.tsx` L11 | "no Connect Admin role" |
| `pathshala/actions.ts` L140, L153, L180 | Connect Admin / signed in to Connect |
| `events/actions.ts` L275 | "signed in to Connect" |
| `login/actions.ts` L24 | "a Connect login" |
| `pathshala/.../attendance-sheet.tsx` L319 | "the Connect app" |
| `pathshala/announcements/page.tsx` L53 | "the Connect app" |
| `(console)/content/page.tsx` L129 | "New to JSH guide": tenant-specific, should come from config |

Not user-visible (optional rename): the `deploy/*.sh` comments and the systemd `Description=Connect %i` in all three repos, and the package names.
