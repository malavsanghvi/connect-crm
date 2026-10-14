Pill buttons in five styles, for the actions on every Weaver surface. A static rendition, hand-written from `src/components/site/ui.tsx` (`buttonStyles`) and `.cc-btn` in `src/app/globals.css`.

**When to use:** one primary action per view ("Get started free"), with at most one secondary beside it ("Try the demo"). Links inside text stay links.

**What the consumer provides:** the label (sentence case, says what happens), the destination, and the style for the ground it sits on.

| Style | Ground | Fill | Text | Hover |
| --- | --- | --- | --- | --- |
| primary | `canvas`, `white` | `navy` | `white` | `navy-hover` |
| ghost | `canvas`, `white` | `white`, 2px border of `navy` at 20% | `navy` | border `navy` |
| gold | `navy` | `gold` | `navy` | a lighter gold |
| ghostOnNavy | `navy` | none, 2px border of `white` at 30% | `white` | border `white` |
| accent | `canvas`, `white` | `saffron-strong` | `white` (4.7:1) | `brown` |

`accent` is for the rare action that should feel warm, not for a second primary action: use it instead of putting white text on `saffron`, which is 2.6:1 and never allowed.

Always `radius-pill`. An arrow icon may follow the primary label. Focus: 2px solid `navy` outline, 4px offset.

| Size | Height | Use |
| --- | --- | --- |
| hero | 56px, 32px side padding, 17px label | The hero and the closing call to action |
| primary (`control-primary`) | 52px, 28px side padding, 16px label | A page's one primary action; every button on a phone; the public website |
| compact (`control-compact`) | 40px, 14px label | Dense, mouse-driven tables and toolbars (the admin portal on a desktop) |
| dense (`control-dense`) | 36px, 13px label | Row actions inside a table or a card header, mouse only |

Anything tapped on a touch surface (the member app, the event-day app, the portal on a phone) is at least `tap-target` (48px) tall: a compact or dense button grows to 48px there.
