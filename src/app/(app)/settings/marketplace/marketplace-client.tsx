"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";

import { useStepUp } from "@/components/step-up";
import { useToast } from "@/components/toast";
import { Alert, buttonClass } from "@/components/ui";
import {
  MARKETPLACE_FOOTER,
  MARKET_TABS,
  chipFor,
  needMark,
  productsInTab,
  requestFailed,
  sinceLine,
  type ChipTone,
  type MarketTab,
  type Product,
} from "@/lib/marketplace";

import { cancelRequestAction, notifyMeAction, pauseProductAction, requestProductAction } from "./actions";

const CHIP_CLASS: Record<ChipTone, string> = {
  included: "border-navy-50 bg-navy-50 text-navy",
  on: "border-success-50 bg-success-50 text-success",
  paused: "border-line bg-highlight text-ink-2",
  requested: "border-warning-200 bg-warning-50 text-warning-ink",
  available: "border-line bg-white text-navy",
  coming: "border-line-soft bg-highlight text-muted",
};

function Chip({ state }: { state: Product["state"] }) {
  const c = chipFor(state);
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[12px] font-bold ${CHIP_CLASS[c.tone]}`} data-chip={state}>
      {c.label}
    </span>
  );
}

function Mark({ text, large = false }: { text: string; large?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-field bg-navy font-bold text-white ${large ? "h-11 w-11 text-[15px]" : "h-9 w-9 text-[13px]"}`}
    >
      {text}
    </span>
  );
}

const HOW = [
  "Request a product here, with a note on what it is for.",
  "Weaver checks it and turns it on, confirmed with a fresh sign-in code.",
  "Pause or resume it any time. Pausing never deletes anything.",
];

export function MarketplaceClient({
  products,
  initialTab,
  initialSelected,
  timeZone,
}: {
  products: Product[];
  initialTab: MarketTab;
  initialSelected: string | null;
  timeZone: string;
}) {
  const [tab, setTab] = useState<MarketTab>(initialTab);
  const firstShown = productsInTab(products, initialTab)[0]?.key ?? products[0]?.key ?? null;
  const [selected, setSelected] = useState<string | null>(
    initialSelected && products.some((p) => p.key === initialSelected) ? initialSelected : firstShown,
  );
  const shown = productsInTab(products, tab);
  const product = products.find((p) => p.key === selected) ?? shown[0] ?? products[0] ?? null;
  const detailRef = useRef<HTMLElement>(null);

  function pick(key: string) {
    setSelected(key);
    // On a phone the details sit under the cards: bring them into view.
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches) {
      requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  }

  return (
    <div className="space-y-4">
      <ol aria-label="How it works" className="grid gap-2 sm:grid-cols-3">
        {HOW.map((text, i) => (
          <li key={text} className="flex items-start gap-2.5 rounded-field border border-line bg-white px-3 py-2.5 text-[13px] text-ink-2">
            <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-navy-50 text-[12px] font-bold text-navy">{i + 1}</span>
            <span>{text}</span>
          </li>
        ))}
      </ol>

      <div role="group" aria-label="Filter products" className="flex flex-wrap gap-2">
        {MARKET_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            aria-pressed={tab === t.key}
            className="cc-chip"
            onClick={() => setTab(t.key)}
          >
            {t.label} · {productsInTab(products, t.key).length}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-12 items-start gap-4">
        <section aria-label="Products" className="col-span-12 grid gap-3 sm:grid-cols-2 lg:col-span-7">
          {shown.length === 0 ? (
            <p className="cc-empty sm:col-span-2">Nothing here right now.</p>
          ) : (
            shown.map((p) => (
              <button
                key={p.key}
                type="button"
                aria-pressed={product?.key === p.key}
                onClick={() => pick(p.key)}
                data-product={p.key}
                className={`cc-card flex flex-col gap-2 p-4 text-left transition-colors hover:bg-highlight ${product?.key === p.key ? "ring-2 ring-navy" : ""}`}
              >
                <span className="flex items-center gap-2.5">
                  <Mark text={p.mark} />
                  <span className="font-bold text-ink">{p.name}</span>
                </span>
                <span className="text-[13px] text-muted">{p.line}</span>
                <span className="mt-auto flex flex-wrap items-center justify-between gap-2">
                  <Chip state={p.state} />
                  <span className="text-[12px] font-semibold text-ink-2">{p.built ? p.priceShort : p.targetQuarter ? `Target ${p.targetQuarter}` : p.priceShort}</span>
                </span>
              </button>
            ))
          )}
        </section>

        <aside ref={detailRef} aria-label="Product details" className="col-span-12 scroll-mt-4 lg:sticky lg:top-4 lg:col-span-5">
          {product ? <ProductDetail key={product.key} product={product} timeZone={timeZone} /> : null}
        </aside>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: string }) {
  return <h3 className="text-[11px] font-bold uppercase tracking-wide text-muted">{children}</h3>;
}

function ProductDetail({ product: p, timeZone }: { product: Product; timeZone: string }) {
  const router = useRouter();
  const toast = useToast();
  const stepUp = useStepUp();
  const noteId = useId();
  const [form, setForm] = useState(false);
  const [note, setNote] = useState("");
  const [failedRequest, setFailedRequest] = useState<string | null>(null);
  const [confirmPause, setConfirmPause] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [working, startTransition] = useTransition();
  const since = sinceLine(p, timeZone);

  function run(call: () => Promise<{ ok: boolean; error?: string; message?: string; stepUp?: boolean }>, what: string, after?: () => void) {
    setError(null);
    startTransition(async () => {
      try {
        const res = stepUp ? await stepUp.run(call, what) : await call();
        if (!res.ok) {
          setError(res.error ?? `Could not ${what.toLowerCase()} — the server gave no reason.`);
          toast?.show(res.error ?? "Something went wrong", "bad");
          return;
        }
        after?.();
        toast?.show(res.message ?? "Done", "ok");
        router.refresh();
      } catch (err) {
        console.error("[settings/marketplace] action failed:", err);
        const text = `Could not ${what.toLowerCase()} — the server did not respond. Nothing was changed. Try again.`;
        setError(text);
        toast?.show(text, "bad");
      }
    });
  }

  function send() {
    setFailedRequest(null);
    startTransition(async () => {
      try {
        const res = await requestProductAction(p.key, p.name, note);
        if (!res.ok) {
          setFailedRequest(requestFailed(res.error));
          return;
        }
        setForm(false);
        setNote("");
        toast?.show(res.message ?? `${p.name} requested.`, "ok");
        router.refresh();
      } catch (err) {
        console.error("[settings/marketplace] the request failed:", err);
        setFailedRequest(requestFailed("Could not send the request — the server did not respond."));
      }
    });
  }

  const errorLine = error ? (
    <p role="alert" className="text-[13px] font-semibold text-danger">
      {error}
    </p>
  ) : null;

  return (
    <div className="cc-card space-y-4 p-[18px]" data-detail={p.key} data-state={p.state}>
      <div className="flex items-center gap-3">
        <Mark text={p.mark} large />
        <div className="min-w-0 flex-1">
          <h2 className="cc-card-title">{p.name}</h2>
          <div className="mt-1">
            <Chip state={p.state} />
          </div>
        </div>
      </div>
      <p className="text-[13px] text-ink-2">{p.line}</p>

      {p.gets.length > 0 ? (
        <div className="space-y-1.5">
          <SectionTitle>What you get</SectionTitle>
          <ul className="list-disc space-y-1 pl-5 text-[13px] text-ink-2">
            {p.gets.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {p.needs.length > 0 ? (
        <div className="space-y-1.5">
          <SectionTitle>Needs</SectionTitle>
          {p.needs.map((n) => (
            <div key={n.module} className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
              <span className="text-ink-2">{n.label}</span>
              <span className={`font-bold ${n.on ? "text-success" : "text-danger"}`}>{needMark(n)}</span>
            </div>
          ))}
        </div>
      ) : null}

      {p.membersLine ? (
        <div className="space-y-1.5">
          <SectionTitle>What members see</SectionTitle>
          <p className="text-[13px] text-ink-2">{p.membersLine}</p>
        </div>
      ) : null}

      {p.dataLine ? (
        <div className="rounded-field border border-line bg-highlight px-3 py-2 text-[13px]">
          <strong className="block text-ink">Who can see its data</strong>
          <span className="text-ink-2">{p.dataLine}</span>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <SectionTitle>Price</SectionTitle>
        <p className="text-[13px] text-ink-2">{p.price}</p>
      </div>

      <div className="space-y-3 border-t border-line-soft pt-4">
        {p.state === "included" ? <p className="text-[13px] text-ink-2">Included with your community. It is always on.</p> : null}

        {p.state === "on" ? (
          <>
            {since ? <p className="text-[13px] text-ink-2">{since}</p> : null}
            {p.waitingFor.length > 0 ? (
              <p className="text-[13px] font-semibold text-brown">
                It is off while {p.waitingFor.join(" and ")} {p.waitingFor.length === 1 ? "is" : "are"} off.
              </p>
            ) : null}
            {!confirmPause ? (
              <button type="button" className={buttonClass("ghost", "sm")} disabled={working} onClick={() => setConfirmPause(true)}>
                Pause {p.name}
              </button>
            ) : (
              <div className="space-y-2 rounded-field border border-line bg-highlight p-3">
                <p className="text-[13px] text-ink-2">
                  Pausing hides {p.name} for everyone in your community. Nothing is deleted, and you can resume it at any time.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={buttonClass("bad", "sm")}
                    disabled={working || !p.moduleKey}
                    onClick={() => run(() => pauseProductAction(p.moduleKey ?? "", p.name, true), `Pause ${p.name}`, () => setConfirmPause(false))}
                  >
                    {working ? "Pausing…" : "Pause it"}
                  </button>
                  <button type="button" className={buttonClass("ghost", "sm")} disabled={working} onClick={() => setConfirmPause(false)}>
                    Keep it on
                  </button>
                </div>
              </div>
            )}
            {errorLine}
          </>
        ) : null}

        {p.state === "paused" ? (
          <>
            <p className="text-[13px] text-ink-2">
              {since ? `${since}. ` : ""}Members and staff do not see it while it is paused. Everything is kept.
            </p>
            <button
              type="button"
              className={buttonClass("primary", "sm")}
              disabled={working || !p.moduleKey}
              onClick={() => run(() => pauseProductAction(p.moduleKey ?? "", p.name, false), `Resume ${p.name}`)}
            >
              {working ? "Resuming…" : `Resume ${p.name}`}
            </button>
            {errorLine}
          </>
        ) : null}

        {p.state === "available" ? (
          !form ? (
            <>
              {since ? <p className="text-[13px] text-ink-2">{since}</p> : null}
              <button type="button" className={buttonClass("primary", "sm")} onClick={() => {
                  setForm(true);
                  setFailedRequest(null);
                }}>
                Request {p.name}
              </button>
              <p className="text-[12px] text-muted">Weaver turns it on after a quick check. Nothing changes until then.</p>
            </>
          ) : (
            <div className="space-y-2">
              <label htmlFor={noteId} className="block text-[13px] font-bold text-ink">
                What will your community use it for?
              </label>
              <textarea
                id={noteId}
                rows={3}
                className="crm-input w-full"
                value={note}
                maxLength={500}
                placeholder="A sentence is enough"
                onChange={(e) => setNote(e.target.value)}
              />
              <p className="text-[12px] text-muted">Price: {p.price}</p>
              {failedRequest ? <Alert tone="danger">{failedRequest}</Alert> : null}
              <div className="flex flex-wrap gap-2">
                <button type="button" className={buttonClass("primary", "sm")} disabled={working} onClick={send}>
                  {working ? "Sending…" : failedRequest ? "Try again" : "Send request"}
                </button>
                <button
                  type="button"
                  className={buttonClass("ghost", "sm")}
                  disabled={working}
                  onClick={() => {
                    setForm(false);
                    setNote("");
                    setFailedRequest(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )
        ) : null}

        {p.state === "requested" ? (
          <>
            <p className="text-[13px] text-ink-2">
              {since ? `${since}. ` : ""}Weaver checks the request and turns {p.name} on. Your admins get a message when it is on.
            </p>
            {p.requestNote ? <p className="text-[13px] italic text-muted">“{p.requestNote}”</p> : null}
            <button
              type="button"
              className={buttonClass("ghost", "sm")}
              disabled={working}
              onClick={() => run(() => cancelRequestAction(p.key, p.name), "Cancel the request")}
            >
              {working ? "Cancelling…" : "Cancel the request"}
            </button>
            {errorLine}
          </>
        ) : null}

        {p.state === "not_built" ? (
          <>
            <p className="text-[13px] text-ink-2">Not built yet.{p.targetQuarter ? ` Target: ${p.targetQuarter}.` : ""}</p>
            <button
              type="button"
              className={buttonClass("primary", "sm")}
              disabled={working}
              onClick={() => run(() => notifyMeAction(p.key, p.name), "Ask to be told when it is ready")}
            >
              {working ? "Saving…" : "Tell me when it is ready"}
            </button>
            {errorLine}
          </>
        ) : null}

        {p.state === "notified" ? <p className="text-[13px] text-ink-2">We will tell your admins when {p.name} is ready.</p> : null}

        <p className="text-[12px] text-muted">{MARKETPLACE_FOOTER}</p>
      </div>
    </div>
  );
}
