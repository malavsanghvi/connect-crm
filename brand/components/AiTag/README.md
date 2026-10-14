The AI tag and the AI line: how Weaver marks what AI does, always next to the person who decides. A static rendition, hand-written from `src/app/site/page.tsx` (`AiTag`, the pain cards and the tour panels).

**When to use:** wherever a page says what AI does. Label it "AI" for something Weaver does by itself (mapping spreadsheet columns, suggesting QuickBooks matches) and "Niva" for something a person asks (“Which pledges are behind?”).

**What the consumer provides:** the label ("AI" or "Niva") and one sentence in `caption`. The sentence names the human step: “…and the treasurer approves each one.”

- The tag: `ai-tag` style in capitals, `navy-hover` text on a `gold` to `saffron` gradient, `radius-chip`, with a small white dot before the word.
- The line: the tag, then the sentence in `ink-2`, on `saffron-50` with a 1px `saffron-200` border and `radius-tile`.
- The gold-to-saffron gradient is only for this tag (and the headline underline). Never use it for buttons or backgrounds.
- Never show an AI line without the human decision, and never for a feature that is not built.
