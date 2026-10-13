// DEV ONLY. The scripted clicks behind `?do=events-…` in the two previews, so a screenshot can catch each state of the Add to an event
// panel. Each step waits for the one before (the fake server takes a moment to answer).

export const EVENT_STEPS = ["events-open", "events-choose", "events-ask", "events-adding", "events-done", "events-waitlist", "events-full", "events-error", "events-no-access"] as const;
export type EventStep = (typeof EVENT_STEPS)[number];

export const isEventStep = (s: string): s is EventStep => (EVENT_STEPS as readonly string[]).includes(s);

/** Scroll the nearest scrolling ancestor only (scrollIntoView would also move the preview's fixed shell out of view). */
function scrollWithin(el: HTMLElement, block: "start" | "end") {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const overflow = getComputedStyle(p).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && p.scrollHeight > p.clientHeight) {
      const r = el.getBoundingClientRect();
      const pr = p.getBoundingClientRect();
      p.scrollTop += block === "end" ? r.bottom - pr.bottom + 16 : r.top - pr.top - 8;
      return;
    }
  }
}

/** `rootSel` finds the panel's wrapper on the page being previewed. */
export function runEventStep(step: EventStep, rootSel: string) {
  const later = (ms: number, fn: () => void) => window.setTimeout(fn, ms);
  const root = () => document.querySelector<HTMLElement>(rootSel);
  const byText = <T extends HTMLElement>(sel: string, re: RegExp) => [...(root()?.querySelectorAll<T>(sel) ?? [])].find((e) => re.test(e.textContent ?? ""));
  const open = () => byText<HTMLButtonElement>("button", /^\+?\s*Add to an event$/)?.click();
  const pickEvent = (name: RegExp) => byText<HTMLLabelElement>("label", name)?.querySelector("input")?.click();
  const tickChild = () => root()?.querySelector<HTMLInputElement>("p + ul input[type=checkbox]")?.click();
  const ask = () => byText<HTMLButtonElement>("button", /^Add to (?!an event|another)/)?.click();
  const yes = () => byText<HTMLButtonElement>("button", /^(Yes, add them|Try again)/)?.click();
  // Keep the panel in view for the screenshot (the slide-over scrolls; the page does too).
  const show = () => {
    const ask = root()?.querySelector<HTMLElement>('[data-testid="add-to-event-ask"]') ?? root()?.querySelector<HTMLElement>('[data-testid="add-to-event-refusal"], [data-testid="add-to-event-error"], [data-testid="add-to-event-load-error"], [data-testid="add-to-event-no-access"]');
    const el = ask ?? root();
    if (el) scrollWithin(el, ask ? "end" : "start");
  };
  for (const ms of [300, 1000, 1400, 1700, 2200, 3000]) later(ms, show);
  open();
  if (step === "events-open" || step === "events-no-access") return;
  later(900, () => pickEvent(step === "events-waitlist" ? /Neighbourhood cleanup/ : step === "events-full" ? /Weekend camp/ : /Spring Picnic/));
  later(1200, tickChild);
  if (step === "events-choose" || step === "events-full") return;
  later(1500, ask);
  if (step === "events-ask" || step === "events-waitlist") return;
  later(1800, yes);
}
