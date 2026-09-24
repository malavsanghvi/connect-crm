"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Drawer } from "@/components/drawer";
import { HouseholdCard, type CardLabels, type HouseholdCardData } from "@/components/household-card";
import { HouseholdPicker } from "@/components/household-picker";
import { useToast } from "@/components/toast";
import { DrawerSection, buttonClass, type ButtonVariant } from "@/components/ui";

import { findHouseholdsForQboAction, householdMembersAction, mapCustomerAction, type MemberOption } from "./actions";

/**
 * "Map to a household" (Not mapped yet) and "Remap" (Approved): find the
 * household by its card — never by name alone — choose whether the QuickBooks
 * customer is the whole family (history on the primary member) or one person,
 * give a reason, map.
 */
export function MapCustomerButton({
  qboId,
  qboName,
  summary,
  remap = false,
  label,
  variant = "primary",
  defaultLevel,
  labels,
  timeZone,
  currency,
}: {
  qboId: string;
  qboName: string;
  summary: string;
  remap?: boolean;
  label: string;
  variant?: ButtonVariant;
  /** "family" preselects the whole family; "person" nudges toward choosing a person. */
  defaultLevel: "family" | "person";
  labels: CardLabels;
  timeZone: string;
  currency: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [card, setCard] = useState<HouseholdCardData | null>(null);
  const [members, setMembers] = useState<MemberOption[] | null>(null);
  const [person, setPerson] = useState<string>("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function choose(c: HouseholdCardData) {
    setCard(c);
    setMembers(null);
    setPerson("");
    setError(null);
    start(async () => {
      try {
        const res = await householdMembersAction(c.household_id);
        if (!res.ok) setError(res.error);
        else setMembers(res.data ?? []);
      } catch (err) {
        console.error("[qbo-match] loading members failed:", err);
        setError("Could not load the household's members — the server did not respond. Choose the household again.");
      }
    });
  }

  function submit() {
    if (!card) return setError("Choose the household first.");
    if (!reason.trim()) return setError("Give a reason; it is kept in the audit log.");
    setError(null);
    start(async () => {
      try {
        const res = await mapCustomerAction({ qboId, householdId: card.household_id, personId: person || null, reason });
        if (!res.ok) {
          setError(res.error);
          toast?.show(res.error, "bad");
          return;
        }
        toast?.show(res.message ?? "Mapped.", "ok");
        setOpen(false);
        setCard(null);
        setReason("");
        router.refresh();
      } catch (err) {
        console.error("[qbo-match] map failed:", err);
        setError("Could not map the customer — the server did not respond. Reload to see whether it went through before trying again.");
      }
    });
  }

  const primary = members?.find((m) => m.primary) ?? null;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass(variant, "xs")}>
        {label}
      </button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        kicker={remap ? "REMAP QUICKBOOKS CUSTOMER" : "MAP QUICKBOOKS CUSTOMER"}
        title={qboName}
        subtitle={summary}
        footer={
          <button type="button" onClick={submit} disabled={pending || !card} className={buttonClass(card ? "primary" : "off", "sm")}>
            {pending ? "Saving…" : remap ? "Remap" : "Map to this household"}
          </button>
        }
      >
        {remap ? (
          <p className="mb-3 rounded-[10px] border border-saffron/40 bg-saffron-50 px-3 py-2 text-[13px] text-brown">
            Remapping moves the donations and pledges already brought in from QuickBooks to the household you choose. The old match is kept as rejected.
          </p>
        ) : null}
        <DrawerSection title="HOUSEHOLD">
          {card ? (
            <div className="flex flex-col gap-2">
              <HouseholdCard card={card} labels={labels} timeZone={timeZone} currency={currency} />
              <button type="button" onClick={() => setCard(null)} className={buttonClass("ghost", "xs")}>
                Choose another household
              </button>
            </div>
          ) : (
            <HouseholdPicker labels={labels} timeZone={timeZone} currency={currency} idPrefix={`qbo-${qboId}`} finder={findHouseholdsForQboAction} onSelect={choose} autoFocus />
          )}
        </DrawerSection>
        {card ? (
          <DrawerSection title="WHOSE GIVING IS IT">
            <label className="crm-label" htmlFor={`qbo-person-${qboId}`}>
              This QuickBooks customer is
            </label>
            <select id={`qbo-person-${qboId}`} className="crm-input" value={person} onChange={(e) => setPerson(e.target.value)}>
              <option value="">
                The whole family — recorded on the primary member{primary ? ` (${primary.name})` : ""}
              </option>
              {(members ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  Only {m.name}
                  {m.primary ? " (primary member)" : ""}
                </option>
              ))}
            </select>
            {members && !primary && !person ? (
              <p className="mt-1 text-[12px] text-danger">
                This household has no primary member yet. Its QuickBooks history will wait under Needs review until one is chosen on the household.
              </p>
            ) : null}
            {defaultLevel === "person" && !person ? (
              <p className="mt-1 text-[12px] text-muted">The QuickBooks name looks like one person; choose them if their giving is theirs alone.</p>
            ) : null}
          </DrawerSection>
        ) : null}
        <DrawerSection title="REASON">
          <label className="crm-label" htmlFor={`qbo-reason-${qboId}`}>
            Why (kept in the audit log)
          </label>
          <textarea id={`qbo-reason-${qboId}`} className="crm-input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </DrawerSection>
        {error ? (
          <p role="alert" className="mt-2 rounded-[10px] border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
            {error}
          </p>
        ) : null}
      </Drawer>
    </>
  );
}
