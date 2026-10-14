// The AI tag, as brand/components/AiTag describes it: "AI" for something Weaver does by itself and "Niva" for something a person
// asks. ai-tag style in capitals, navy-hover text on the kit's gold to saffron gradient (one of the three places a gradient appears),
// radius-chip, and a small white dot before the word. Never show it without the person who decides, and never for a feature that
// is not built (brand/README.md, "Talking about AI").
export function AiTag({ label = "AI" }: { label?: "AI" | "Niva" }) {
  return (
    <span className="inline-flex flex-none items-center gap-1.5 rounded-chip bg-gradient-to-r from-gold to-saffron px-2 py-1 text-[11px] font-bold uppercase leading-none tracking-[0.06em] text-navy-hover">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-white" />
      {label}
    </span>
  );
}
