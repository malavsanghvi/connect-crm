"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useState, useTransition, type KeyboardEvent, type ReactNode } from "react";

import { Drawer } from "@/components/drawer";
import { HouseholdCard, type CardLabels } from "@/components/household-card";
import { DrawerSection, KeyValueRow, Skeleton, buttonClass } from "@/components/ui";
import { monthYear, pledgeStatusText } from "@/lib/giving";
import { formatCents } from "@/lib/money";

import { householdQuickViewAction, type HouseholdQuickView } from "./household-drawer-action";

type Ctx = { open: (householdId: string) => void };
const DrawerContext = createContext<Ctx | null>(null);

/**
 * Household quick view, as in the prototype: clicking a Giving table row opens
 * the household in a right-hand drawer (household card, recent pledges and
 * links), without leaving the table.
 */
export function HouseholdDrawerProvider({
  children,
  labels,
  timeZone,
  currency,
}: {
  children: ReactNode;
  labels: CardLabels;
  timeZone: string;
  currency: string;
}) {
  const [id, setId] = useState<string | null>(null);
  const [data, setData] = useState<HouseholdQuickView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const load = useCallback((householdId: string) => {
    setId(householdId);
    setData(null);
    setError(null);
    start(async () => {
      try {
        const res = await householdQuickViewAction(householdId);
        if (!res.ok) setError(res.error);
        else setData(res.data ?? null);
      } catch (err) {
        console.error("[giving] household drawer failed:", err);
        setError("Could not open the household — the server did not respond. Try again.");
      }
    });
  }, []);
  const close = useCallback(() => setId(null), []);

  return (
    <DrawerContext.Provider value={{ open: load }}>
      {children}
      <Drawer
        open={id !== null}
        onClose={close}
        kicker="HOUSEHOLD"
        title={data?.card.household_name ?? (error ? "Household" : "Loading…")}
        subtitle={data ? [data.card.household_number, data.card.zone].filter(Boolean).join(" · ") : undefined}
        footer={
          id ? (
            <>
              <Link href={`/households/${id}?tab=pledges`} className={buttonClass("ghost", "sm")}>
                Pledges
              </Link>
              <Link href={`/households/${id}`} className={buttonClass("primary", "sm")}>
                Open household
              </Link>
            </>
          ) : null
        }
      >
        {error ? (
          <div role="alert" className="rounded-[10px] border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
            {error}
            {id ? (
              <button type="button" onClick={() => load(id)} className={`${buttonClass("bad", "xs")} ml-2`}>
                Try again
              </button>
            ) : null}
          </div>
        ) : pending || !data ? (
          <div className="flex flex-col gap-2">
            <Skeleton height={96} />
            <Skeleton height={36} />
            <Skeleton height={36} />
          </div>
        ) : (
          <>
            <HouseholdCard card={data.card} labels={labels} timeZone={timeZone} currency={currency} />
            <DrawerSection title="RECENT PLEDGES">
              {data.pledgesError ? <p className="text-[13px] text-danger">{data.pledgesError}</p> : null}
              {data.pledges.length === 0 && !data.pledgesError ? <p className="text-[13px] text-muted">No pledges yet.</p> : null}
              {data.pledges.map((p, i) => {
                const s = pledgeStatusText(p.status, p.amount_cents, p.paid_cents);
                return (
                  <KeyValueRow
                    key={`${p.pledge_number}-${i}`}
                    label={`${p.campaign ?? "General"} · ${monthYear(p.pledged_at, timeZone)}`}
                    value={`${formatCents(p.amount_cents, currency)} · ${s.label}`}
                    tone={s.tone === "ok" ? "ok" : s.tone === "warn" ? "warn" : "ink"}
                  />
                );
              })}
            </DrawerSection>
          </>
        )}
      </Drawer>
    </DrawerContext.Provider>
  );
}

/** A table row that opens the household drawer (keyboard: Enter / Space). */
export function HouseholdRow({ householdId, children, label }: { householdId: string; children: ReactNode; label: string }) {
  const ctx = useContext(DrawerContext);
  if (!ctx) return <tr>{children}</tr>;
  const open = () => ctx.open(householdId);
  return (
    <tr
      tabIndex={0}
      aria-label={label}
      onClick={(e) => {
        // Let links and buttons inside the row do their own thing.
        if ((e.target as HTMLElement).closest("a,button,input,select,textarea,summary,details,form")) return;
        open();
      }}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
      className="cursor-pointer hover:[&>td]:bg-highlight focus-visible:outline-2 focus-visible:outline-navy"
    >
      {children}
    </tr>
  );
}
