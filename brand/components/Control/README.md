Fields, tags, warnings and the sizes of controls: the parts of a form and a table. A static rendition, hand-written from `.crm-input`, `.cc-tag` and `.cc-btn` in `src/app/globals.css`.

**When to use:** every form, filter bar and table of Weaver's admin screens, the member app and the event-day app.

**What the consumer provides:** a label (sentence case, above the field), the value, and for a tag its words.

- **Field:** `white` fill, 1px `line-control` border (3:1: never `line-input`), `radius-field` (12px), 16px text on a touch surface (14px on a desktop), `faint` placeholder. Focus: 2px solid `navy` outline, border `navy`. Disabled: `canvas` fill, `muted` text. Error: a 1px `danger` border and a message in `danger` below, saying what went wrong and how to fix it.
- **Height:** `control-compact` (40px) in a desktop toolbar or dense form; `control-primary` (52px) on a phone and in a one-field screen; `tap-target` (48px) is the least on a touch surface.
- **Tag:** `radius-tag` (8px), `ai-tag` style or 11 to 12px bold, a solid `navy` with white text or a tint (`navy-50` with `navy`, `success-50` with `success`, `danger-50` with `danger`, `warning-50` with `warning-ink`). Always words. One hue for the parts of a product: `navy`.
- **Warning message:** `warning-50` fill, 1px `warning-200` border, `radius-tile`, a `warning` alert icon, `warning-ink` text.
- **Identifier:** set in `identifier` (JetBrains Mono), `ink`, never wrapped mid-token.
