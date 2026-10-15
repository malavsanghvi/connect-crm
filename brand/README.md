Weaver is a community management platform for mission-driven organizations built around families: places of worship, cultural associations, community centers, heritage schools, nonprofits and clubs. We stand beside them as a **mission partner**: Weaver takes the operations off volunteers' plates so they can do more good, and it is free for every organization. Everything below serves that one idea. When in doubt, ask: does this give a volunteer time back, and is it true today?

## Voice

### The lines we use, word for word

| Use | Line |
| --- | --- |
| The promise (hero, page title) | Do more good. Weaver handles the operations. For free. Forever. |
| Why it is free | This is our way of paying it forward. |
| The belief | Every hour a volunteer spends on admin is an hour taken from the mission. |
| How we use AI | AI does the busywork. People make the final decisions. |
| The partner promise | Partner is a promise. Here is ours. |
| Leaving | If you ever want to leave, we'll help you go. We're confident you'll stay. |
| Closing call to action | Give your volunteers their time back. |
| The generosity line | Built and Runs on Generosity |
| Under the wordmark | Community management platform |

Never paraphrase these. Set the promise in `hero` with "For free. Forever." as the highlighted phrase.

### How we write

- Write plain English in short, active sentences. "We" is Weaver; "you" is the organization; the people in it are "members", and families are "households".
- Name the pain, then what Weaver does about it: "Matching Zelle payments and checks to pledges by hand" → "Bank statements match to the right household and pledge, then post to QuickBooks after the treasurer's final click."
- Use sentence case for headings and buttons. Capitals only in the eyebrow and the AI tag. No emoji, no exclamation marks.
- Claim only what works today. A feature that is not built gets a target quarter or stays off the page. Never write "AI Native", "end-to-end encrypted" (say "encrypted in transit and at rest") or "coming soon" without a date.
- Buttons say what happens: "Get started free", "Try the demo", "Download the setup checklist".

### Words

| Say | Not |
| --- | --- |
| pledge | bid |
| Chip In (always optional, with a yearly limit on each account) | tip, fee, donation to Weaver |
| mission-driven organizations | nonprofits (when speaking to everyone) |
| household card | a family's name on its own |
| Niva | the bot, the AI |
| no cut of your gifts | zero fees (card payments carry Stripe's fee, which goes to Stripe) |

### Money, people and data

- Write whole dollars in headlines ($150) and keep cents when there are any ($7.50).
- Never identify a household by its name alone: show the household card, with its IDs, members and last gift.
- Label every picture of the product "Sample data". Use no real people's names or photos.
- Speak to every organization. Keep any single faith's words, holidays and examples out of platform copy; the three Weavers below name who it serves.

### Talking about AI

Pair every AI capability with the person who decides. The pattern is "Ask Niva to …" plus what a person confirms: "Ask Niva to match a deposit to the checks you recorded. AI suggests QuickBooks matches for the treasurer to approve." Put each AI line in the AI line component (`AiTag` on `saffron-50`).

Niva is shown by the AI tag labelled "Niva", never by a colour of its own. Its button in an interface is an ordinary button: a `navy-50` tile with an `ink` sparkle, or a `navy` button. No gradient fill, no coloured orb, no glow.

## The three Weavers

One platform, every feature, named for who it serves.

| Name | For |
| --- | --- |
| Faith Weaver | Churches, gurdwaras, mosques, synagogues and temples |
| Community Weaver | Cultural associations, community centers and heritage schools |
| Org Weaver | Chambers of commerce, nonprofits, professional societies and clubs |

## Logo

- Use the files in `logos/` (the SVG master, PNGs and the full logo on light and indigo) exactly as they are. The mark is a ribbon W in teal, blue and green, folding into indigo and lavender beneath, with a sun above. Never recolour, outline, rotate, stretch or redraw it.
- The lockup is the mark, then "Weaver" in `wordmark` (`navy`), with "Community management platform" under it in `descriptor` (`muted`). Set the mark 44px tall beside the 24px name, 6px apart.
- On `navy` or any dark ground, put the mark on a `white` tile (`radius-logo-tile`, the mark at about 72% of the tile), the name in `white` and the descriptor in `navy-200`.
- On the `saffron` header, the mark sits directly on the orange, the name in `navy` and the descriptor in `ink` (`muted` is too light there).
- The favicon and the app icon use the same mark file.

## Colour

- **Indigo (`navy`)** carries the brand: headings, primary buttons, the AI band, the closing call to action and the footer.
- **Sunrise (`saffron`)** is the signature ground and the decoration: the header, the band behind the hero card, dots, bars, picture washes. It is never text, and never a fill for white text.
- **Strong sunrise (`saffron-strong`)** is the orange a person must read or tap: a button fill that carries white text (4.7:1) and accent text on `white` or `canvas`. Rule of thumb: decoration and highlight are `saffron`; text and buttons are `saffron-strong`. Hover and pressed are `brown`. On `saffron-50` set text in `brown` (`saffron-strong` is 4.3:1 there).
- **Sun gold (`gold`)** is the one highlight in a view: the $0 badge, step numbers, the gold button on `navy`.
- **Ember (`brown`)** is the accent for text: eyebrows, the highlighted headline phrase, the closing promise.
- **Surfaces:** `canvas` for the page, `white` for cards, `ground` for a quiet section; borders in `line`. Tints `navy-50` (icon tiles) and `saffron-50` (AI lines, eyebrows).
- **Text greys:** `ink`, then `ink-2`, then `muted` for supporting text, then `faint` for hints, placeholders and timestamps (5.2:1 on `white`, 5.1:1 on `canvas`). Nothing is set lighter than `faint`.
- **Control borders:** a real control (text field, select, checkbox, radio, the off state of a switch) is outlined in `line-control` (3.5:1 on `white`, 3.4:1 on `canvas`). `line-input` is only for inputs drawn inside a picture of the product, where nobody types.
- **Status:** `success`, `danger` and `warning` (with `warning-50`, `warning-200` and `warning-ink`), always beside words. A warning message is `warning-50` with a 1px `warning-200` border, a `warning` icon and `warning-ink` text.
- **Tags and tiles for the parts of a product** (events, learning, the store, messages) use one hue, `navy` on `navy-50` or white on `navy`. The kit has no colour per module: the words and the icon say which part it is.
- The `mark-*` colours belong to the logo only. Do not use them in the interface.

Pairs that pass, and the ones that do not:

| Text | On | Contrast |
| --- | --- | --- |
| `ink` | `canvas` | 14.7:1 |
| `muted` | `canvas` / `white` | 6.5:1 / 6.7:1 |
| `white` | `navy` | 11.7:1 |
| `navy-200` | `navy` | 8.0:1 |
| `navy-hover` | `gold` | 8.8:1 |
| `ink` | `saffron` | 5.8:1 |
| `brown` | `saffron-50` / `white` | 5.6:1 / 6.1:1 |
| `faint` | `white` / `canvas` / `ground` | 5.2:1 / 5.1:1 / 4.9:1 |
| `white` | `saffron-strong` | 4.7:1 |
| `saffron-strong` | `white` / `canvas` | 4.7:1 / 4.5:1 |
| `warning` | `white` / `warning-50` | 5.9:1 / 5.5:1 |
| `warning-ink` | `warning-50` | 8.6:1 |
| `line-control` (a border, not text) | `white` / `canvas` / `ground` | 3.5:1 / 3.4:1 / 3.3:1 |
| `navy` icons | `navy-50` | 10.2:1 |
| `white` | `saffron` | 2.6:1: never |
| `saffron` or `gold` | `white` | below 3:1: never as text |
| `saffron-strong` | `saffron-50` | 4.3:1: use `brown` |
| `line-input` (a border) | `white` | 1.4:1: never on a real control |

## Type

- Bricolage Grotesque for display: headings, big numbers and the wordmark (`hero`, `heading`, `heading-sm`, `statement`, `card-title`, `wordmark`). Track it tight, as the styles say.
- Hanken Grotesk for everything else (`lead`, `body`, `body-sm`, `caption`, `button`, `eyebrow`, `descriptor`, `ai-tag`).
- JetBrains Mono for identifiers only (`identifier`): receipt, pledge, household and member numbers, codes, payer references. It keeps `0` and `O` apart. Never for running text, headings or buttons, and never for an amount (amounts stay in Hanken Grotesk, with tabular figures).
- One `hero` per page. Section headings in `heading`, with a `lead` under them when they need one.
- Weights run from 400 to 700; nothing is set heavier.
- Captions are `caption` (14.5px) at the smallest on a touch surface; 11 to 13px labels belong to dense desktop tables and toolbars.
- All three faces are served by Google Fonts; load Bricolage Grotesque with its optical-size axis.

## Layout and shape

- Content sits in a `container` with `gutter` sides (`gutter-wide` from tablets up). Sections breathe with `section-y`, `section-y-md`, `section-y-lg`; a heading sits `stack` above its content.
- The hero is a `white` card with `radius-hero` and `shadow-hero`, sitting on a `saffron` band that covers the top 58% of the section and stops at `canvas`.
- Cards are `white` on `canvas`, a 1px `line` border, `radius-card`, `card-pad` (`card-pad-lg` from tablets). No coloured left-border accents.
- Bands are `navy`. The closing call to action is a `navy` band with `radius-band` and two soft circles (white at 5%, `saffron` at 25%) behind the words.
- Buttons are pills (`radius-pill`). Their height says how much they matter and what input they expect: `control-primary` (52px; 56px in the hero) for a page's one primary action, for every button on a phone and on the public website; `control-compact` (40px) and `control-dense` (36px) only in dense, mouse-driven tables and toolbars. On a touch surface nothing tapped is smaller than `tap-target` (48px).
- Text fields, selects and textareas take `radius-field` (12px) and a `line-control` border; status tags and small labels take `radius-tag` (8px). Icons sit in 48px tiles with `radius-tile`.
- Gradients appear in three places only: the AI tag (`gold` to `saffron`), the underline behind the highlighted headline phrase (`gold` to `saffron`, 26% of the line height), and the wash behind product pictures (`saffron-50` to `canvas` to `navy-50`).

## Imagery

- Show the product, drawn in HTML and CSS with sample data, in a window frame (`radius-window`, `shadow-window`, a `ground` title bar with three dots).
- The hero picture is a new treasurer's first day: the handover on record, then Niva answering "What's waiting on me?".
- No stock photos, faces, mascots or illustrations of people.

## Iconography

- The icon set is 42 stroke icons on a 24px grid: stroke 2, round caps and joins, no fill (`icons/`). The files are the source: the website and the admin portal draw them with one `Icon` component generated from these files. Add a new icon here, in the same style, rather than drawing one inline.
- In the interface icons take the colour of their text; the files here are drawn in `navy`.
- Icons are decorative: the words beside them carry the meaning. Put a section's icon in a 48px tile (`navy-50` with `navy`, or `saffron-50` with `brown`).
- No emoji, ever.

## Accessibility

- Focus is a 2px solid `navy` outline with a 2px offset (4px on buttons).
- Anything tapped on a touch surface is at least `tap-target` (48px) tall and wide; a page's one primary action and every button on a phone is `control-primary` (52px). Compact controls (`control-compact` 40px, `control-dense` 36px) are for a mouse, in dense tables and toolbars only.
- A control's outline is `line-control` (3:1 against the surface); its focus ring stays the 2px `navy` outline.
- Keep to the contrast pairs above. The header's text uses `ink` because `ink-2` sits at the 4.5:1 edge on `saffron`.
- Status always has words: a tick in `success` sits beside its label; errors in `danger` say what went wrong and how to fix it.
