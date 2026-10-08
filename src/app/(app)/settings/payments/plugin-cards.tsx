"use client";

import Link from "next/link";
import { useId, useState, type ReactNode } from "react";

import { Toggle } from "@/components/controls";
import { Badge, buttonClass, Card, InfoBox } from "@/components/ui";
import { waitingRequests } from "@/lib/payments/change-control";
import { pluginByKey, pluginLabel, type PluginKey } from "@/lib/payments/plugins/catalog";
import { paymentPluginConfigProblem, pluginStatusView } from "@/lib/payments/plugins/config";
import { pluginDisplayName, type PluginEntry, type PluginSettings } from "@/lib/payments/plugins/view";
import { OFFLINE_METHODS, type PaymentSettings } from "@/lib/payments/view";

import { setPluginAction } from "./actions";
import { PayeeRequestsCard, ReadinessCard, RequestZelleChange, WalletConfirm, ZelleApprovalRow, type ChangeControl } from "./change-control";
import { MethodEditor, ProcessorPanel, processorConnected, usePaymentsPanel } from "./payments-panel";

// One card per payment plugin (docs/PAYMENTS_PLAN.md §2.2), in the organization's order: its name
// (the one members see), its status, what to do next, and the on/off switch. Every switch asks for
// a reason (kept in the audit log) and writes through app.set_payment_plugin, which uses the same
// database functions the old checkboxes did; the database refuses what is not allowed and the
// refusal is shown here in plain English.

const DESCRIPTIONS: Partial<Record<PluginKey, string>> = {
  card: "Cards through the organization's own Stripe account (Stripe Connect).",
  apple_pay: "Shows on Stripe's checkout page when the member's device and your Stripe account allow it.",
  google_pay: "Shows on Stripe's checkout page when the member's device and your Stripe account allow it.",
  bank_debit: "Off unless you turn it on. When it is on, Stripe's checkout page also offers paying from a US bank account.",
  paypal: "PayPal, through the organization's own PayPal Business account.",
  zelle: "Members send Zelle from their own bank app to the organization's Zelle address; the treasurer matches it on the bank statement.",
};

function effectNote(p: PluginEntry, on: boolean, name: string): ReactNode {
  if (p.family === "provider_checkout") {
    if (p.key === "card" && !on) return <p>{name} stops being offered, and so do Apple Pay, Google Pay and ACH, which ride on it.</p>;
    return on
      ? <p>Members can choose {name} on the provider&apos;s checkout page once the account is connected and ready.</p>
      : <p>Members stop seeing {name}. Payments already made are not touched.</p>;
  }
  return on
    ? <p>Members see the {name} instructions under How to give.</p>
    : <p>Members stop seeing the {name} instructions. Nothing already recorded changes.</p>;
}

export function PluginCards({ s, ps, tz, cc }: { s: PaymentSettings; ps: PluginSettings; tz: string; cc?: ChangeControl }) {
  const known = ps.plugins.filter((p) => pluginByKey(p.key));
  return (
    <>
      {cc ? <PayeeRequestsCard cc={cc} tz={tz} /> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        {known.map((p) => (
          <PluginCard key={p.key} p={p} ps={ps} s={s} tz={tz} cc={cc} />
        ))}
      </div>
      {cc ? <ReadinessCard cc={cc} /> : null}
    </>
  );
}

function PluginCard({ p, ps, s, tz, cc }: { p: PluginEntry; ps: PluginSettings; s: PaymentSettings; tz: string; cc?: ChangeControl }) {
  const { run, busy, askReason } = usePaymentsPanel();
  const plugin = pluginByKey(p.key);
  const name = pluginDisplayName(p);
  const chip = pluginStatusView(p.status, ps.environment, p.family);
  const proc = p.provider ? s.processors.find((x) => x.processor === p.provider) : undefined;
  const row = p.family !== "provider_checkout" ? s.methods.find((m) => m.method === plugin?.legacyMethod) : undefined;
  const def = OFFLINE_METHODS.find((m) => m.method === plugin?.legacyMethod);
  const catalogSort = plugin?.sort ?? p.sort;
  const sortOverride = p.sort === catalogSort ? null : p.sort;
  // The Zelle address and name, once saved, are changed by asking for it: a second person confirms (migration 0597).
  const zelleLocked = p.key === "zelle" ? ["recipient", "name"].filter((k) => (row?.instructions?.[k] ?? "").trim() !== "") : [];
  const waiting = cc?.queue ? waitingRequests(cc.queue, p.key).length : 0;

  // What stops the switch, said next to it (the database is still the rule).
  const providerWho = p.provider === "paypal" ? "PayPal" : "Stripe";
  const lockedOn = p.enabled && (p.key === "card" || p.key === "paypal") && processorConnected(proc);
  const depOff = !p.enabled ? p.depends_on.find((d) => !ps.plugins.find((x) => x.key === d)?.enabled) : undefined;
  const suspended = p.catalog_status === "suspended";
  const onMode = p.family === "provider_checkout" ? p.mode : ps.environment === "production" ? "live" : "test";
  const savedProblem = !p.enabled && p.family !== "provider_checkout"
    ? paymentPluginConfigProblem(p.key, p.config, onMode, row?.required ?? [])
    : null;
  let blocked: string | null = null;
  if (lockedOn) {
    blocked = p.key === "card"
      ? `${providerWho} is connected, so Card stays on. To stop taking card payments, disconnect ${providerWho} below.`
      : `${providerWho} is connected, so PayPal stays on. To stop taking PayPal payments, disconnect ${providerWho} below.`;
  } else if (!p.enabled && suspended) {
    blocked = `Community Connect has paused ${p.label} for now.`;
  } else if (depOff) {
    blocked = `Turn ${pluginLabel(depOff)} on first.`;
  } else if (savedProblem) {
    blocked = `Before turning it on: ${savedProblem} Save the instructions below, then turn it on.`;
  }

  const toggle = (on: boolean) =>
    askReason({
      title: `Turn ${name} ${on ? "on" : "off"}`,
      confirmLabel: on ? "Turn on" : "Turn off",
      tone: on ? "primary" : "bad",
      body: effectNote(p, on, name),
      run: async (reason) =>
        void (await run(`plugin-${p.key}`, `turn ${on ? "on" : "off"} ${name}`, () => setPluginAction(p.key, on, p.label_override, sortOverride, reason))),
    });

  return (
    <Card
      title={name}
      description={DESCRIPTIONS[p.key as PluginKey] ?? (p.family === "instructions" ? "Offline: members see these instructions under How to give." : undefined)}
      actions={<Badge tone={chip.tone}>{chip.label}</Badge>}
      className={p.key === "card" || p.key === "paypal" ? "lg:col-span-2" : ""}
    >
      <div className="flex flex-col gap-3 text-[13px]">
        <div className="flex flex-wrap items-center gap-3">
          <Toggle
            label={`Offer ${name}`}
            checked={p.enabled}
            disabled={!ps.can_configure || busy !== null || (!p.enabled && blocked !== null) || lockedOn}
            onNote="On"
            offNote="Off"
            onChange={toggle}
          />
          {p.label_override ? <span className="text-muted">Shown to members as “{name}” (Community Connect calls it {p.label}).</span> : null}
        </div>
        {blocked ? <p className="text-muted">{blocked}</p> : null}
        {p.problem && p.problem !== blocked ? <p className={p.status === "needs_setup" || p.status === "suspended" ? "text-danger" : "text-muted"}>{p.problem}</p> : null}

        {p.key === "card" && proc ? <ProcessorPanel p={proc} s={s} tz={tz} run={run} busy={busy} askReason={askReason} /> : null}
        {p.key === "paypal" && proc ? <ProcessorPanel p={proc} s={s} tz={tz} run={run} busy={busy} askReason={askReason} /> : null}
        {p.key === "zelle" ? (
          <>
            {ps.environment === "sandbox" ? (
              <InfoBox>Rehearsal: members see &quot;Sandbox: no real money moves&quot;, never this address.</InfoBox>
            ) : null}
            <p>
              <Link className="crm-link" href="/giving/payments/bank?view=zelle">Match Zelle payments on the bank statement</Link>
            </p>
            {waiting > 0 ? (
              <InfoBox>A change to the Zelle details is waiting for a second person (see Changes to where gifts go). Members keep seeing the current details until it is confirmed.</InfoBox>
            ) : null}
            {cc && (cc.queue?.can_request ?? ps.can_configure) ? (
              <RequestZelleChange current={{ recipient: row?.instructions?.recipient ?? "", name: row?.instructions?.name ?? "" }} waiting={waiting} />
            ) : null}
            {cc ? <ZelleApprovalRow cc={cc} tz={tz} /> : null}
          </>
        ) : null}
        {p.key === "paypal" && waiting > 0 ? (
          <InfoBox>A change of the PayPal email is waiting for a second person (see Changes to where gifts go). PayPal keeps using the current email until it is confirmed.</InfoBox>
        ) : null}
        {cc && (p.key === "apple_pay" || p.key === "google_pay") && p.enabled ? <WalletConfirm pluginKey={p.key} label={p.label} cc={cc} /> : null}
        {/* The method row keeps its own place in the old list (installed apps order "How to give" by it). */}
        {def ? (
          <MethodEditor def={def} row={row} enabled={p.enabled} sort={row?.sort ?? 0} canEdit={ps.can_configure} run={run} busy={busy} askReason={askReason} lockedFields={zelleLocked} />
        ) : null}

        {ps.can_configure ? <RenameOrder p={p} name={name} catalogSort={catalogSort} /> : null}
      </div>
    </Card>
  );
}

function RenameOrder({ p, name, catalogSort }: { p: PluginEntry; name: string; catalogSort: number }) {
  const { run, busy, askReason } = usePaymentsPanel();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(p.label_override ?? "");
  const [order, setOrder] = useState(p.sort === catalogSort ? "" : String(p.sort));
  const nameId = useId();
  const orderId = useId();
  const n = order.trim() === "" ? null : Number(order);
  const orderProblem = n !== null && (!Number.isInteger(n) || n < 0 || n > 999) ? "The order is a whole number from 0 to 999." : null;
  const labelProblem = label.trim().length > 40 ? "The name members see can be at most 40 characters." : null;
  if (!open) {
    return (
      <div>
        <button type="button" className={buttonClass("ghost", "xs")} disabled={busy !== null} onClick={() => setOpen(true)}>
          Rename / order
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
      <label htmlFor={nameId} className="flex flex-col">
        <span>Name members see</span>
        <input id={nameId} className="crm-input w-56" maxLength={40} placeholder={p.label} value={label} onChange={(e) => setLabel(e.target.value)} />
      </label>
      <label htmlFor={orderId} className="flex flex-col">
        <span>Order (lower first)</span>
        <input id={orderId} className="crm-input w-28" inputMode="numeric" placeholder={String(catalogSort)} value={order}
          onChange={(e) => setOrder(e.target.value.replace(/[^\d]/g, ""))} />
      </label>
      <button type="button" className={buttonClass("primary", "sm")} disabled={busy !== null || !!orderProblem || !!labelProblem}
        onClick={() => askReason({
          title: `Rename or reorder ${name}`, confirmLabel: "Save", body: <p>Leave the name empty to use “{p.label}”, and the order empty for the usual place.</p>,
          run: async (reason) => {
            const res = await run(`rename-${p.key}`, `save the name and order of ${name}`,
              () => setPluginAction(p.key, p.enabled, label.trim() || null, n, reason, "rename"));
            if (res?.ok) setOpen(false);
          },
        })}>
        Save
      </button>
      <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setOpen(false)}>
        Cancel
      </button>
      {orderProblem ? <p className="w-full text-danger">{orderProblem}</p> : null}
      {labelProblem ? <p className="w-full text-danger">{labelProblem}</p> : null}
    </div>
  );
}
