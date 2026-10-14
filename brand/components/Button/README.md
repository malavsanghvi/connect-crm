Pill buttons in four styles, for the actions on Weaver's public pages. A static rendition, hand-written from `src/components/site/ui.tsx` (`buttonStyles`).

**When to use:** one primary action per view ("Get started free"), with at most one secondary beside it ("Try the demo"). Links inside text stay links.

**What the consumer provides:** the label (sentence case, says what happens), the destination, and the style for the ground it sits on.

| Style | Ground | Fill | Text | Hover |
| --- | --- | --- | --- | --- |
| primary | `canvas`, `white` | `navy` | `white` | `navy-hover` |
| ghost | `canvas`, `white` | `white`, 2px border of `navy` at 20% | `navy` | border `navy` |
| gold | `navy` | `gold` | `navy` | a lighter gold |
| ghostOnNavy | `navy` | none, 2px border of `white` at 30% | `white` | border `white` |

Sizes: 52px tall, 28px side padding, `button` at 16px; in the hero and the closing call to action, 56px tall, 32px padding, 17px. Always `radius-pill`. An arrow icon may follow the primary label. Focus: 2px solid `navy` outline, 4px offset.
