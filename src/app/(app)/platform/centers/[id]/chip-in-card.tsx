import { ActionForm } from "@/components/action-form";
import { Toggle } from "@/components/controls";
import { Card, SectionLabel, StatusText, TableWrap } from "@/components/ui";
import type { ChipInCardData } from "@/lib/data/chip-in-platform";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import {
  canTurnOn,
  CHIP_IN_MAX_SUGGESTIONS,
  dollarsInput,
  FEE_CLASSES,
  FEE_CLASS_SHORT,
  isNotSet,
  NOT_SET,
  rateText,
  suggestionsText,
  TURN_ON_BLOCKED,
  type ChipInModeFigures,
  type ChipInOverview,
  type ChipInSettings,
  type FeeRates,
} from "@/lib/payments/chip-in-platform";

import { FeeRateForm } from "../../_components/fee-rate-form";
import { NoAccessNote, SectionProblem } from "../../_components/section-problem";
import { saveChipInAction } from "./actions";

/**
 * Platform › Centers › [organization] › "Chip In and card fees" (docs/PAYMENT_ADDONS.md §11.2). The Weaver team decides here whether
 * an organization's members are asked for an optional Chip In to Weaver at payment, up to what yearly limit per account, with which
 * suggested amounts, and which Stripe fee rate estimates the card fee a member may cover. Platform admins only (the page checks, the
 * database enforces). Every change needs a reason and is audited; no fresh 2FA code (owner rule of 2026-10-14). While the switch is off,
 * or while nothing is saved, nothing is asked of any member.
 */
export function ChipInCard({ centerId, data, tz }: { centerId: string; data: ChipInCardData; tz: string }) {
  const retryHref = `/platform/centers/${centerId}`;
  const settings = data.settings;
  const refused = !settings.ok && settings.reason === "no_access";
  return (
    <Card
      span={12}
      title="Chip In and card fees"
      description="Whether this organization's members are asked for an optional Chip In to Weaver, and the card fee estimate · Weaver team only · every change needs a reason and is audited · the organization's owner sees a notice on Home"
    >
      {refused ? (
        <NoAccessNote />
      ) : !settings.ok ? (
        <SectionProblem section={settings} what="the Chip In settings" retryHref={retryHref} />
      ) : (
        <ChipInSettingsForm centerId={centerId} saved={settings.value} changedBy={data.changedBy} tz={tz} />
      )}

      {refused ? null : (
        <>
          <div className="mt-5">
            <SectionLabel>This year</SectionLabel>
            {data.overview.ok ? <ThisYear overview={data.overview.value} /> : <SectionProblem section={data.overview} what="the Chip In figures" retryHref={retryHref} />}
          </div>
          <div className="mt-5">
            <SectionLabel>Card fee estimate</SectionLabel>
            {data.rates.ok ? <RatesBlock rates={data.rates.value} tz={tz} centerId={centerId} /> : <SectionProblem section={data.rates} what="the card fee rates" retryHref={retryHref} />}
          </div>
        </>
      )}
    </Card>
  );
}

function ChipInSettingsForm({ centerId, saved, changedBy, tz }: { centerId: string; saved: ChipInSettings | null; changedBy: string; tz: string }) {
  const turnOnOk = canTurnOn(saved);
  const notSet = isNotSet(saved);
  const suggested = saved?.suggestedCents ?? [];
  const slots = Array.from({ length: CHIP_IN_MAX_SUGGESTIONS }, (_, i) => dollarsInput(suggested[i]));
  return (
    <>
      <p className="mb-1 text-[13px]" data-testid="chip-in-state">
        {notSet ? (
          NOT_SET
        ) : (
          <>
            Now: <StatusText tone={saved?.asking ? "ok" : "warn"}>{saved?.asking ? "Members are asked" : "Members are not asked"}</StatusText> · Yearly limit per account:{" "}
            <strong>{typeof saved?.yearlyLimitCents === "number" ? formatCents(saved.yearlyLimitCents, "USD") : "not set"}</strong> · Suggested:{" "}
            <strong>{suggested.length > 0 ? suggestionsText(suggested) : "none"}</strong>
          </>
        )}
      </p>
      <p className="crm-hint mb-3">
        Nothing is asked of any member until the switch below is on. A member can always pay with no Chip In. The Chip In is added on top of what the organization charges and
        is never taken out of it.
      </p>
      {/* resetOnSuccess clears the Reason after a save (so it is never reused by accident) and puts the saved amounts back in their boxes. */}
      <ActionForm action={saveChipInAction} submitLabel="Save Chip In settings" size="sm" className="space-y-4" resetOnSuccess>
        <input type="hidden" name="center" value={centerId} />
        <div>
          <Toggle
            name="asking"
            defaultChecked={saved?.asking ?? false}
            disabled={!turnOnOk}
            label="Ask members for a Chip In"
            onNote="On: members are asked for an optional Chip In when they pay by card or bank debit"
            offNote="Off: no Chip In is asked"
          />
          {turnOnOk ? null : (
            <p role="note" className="crm-hint mt-1" data-testid="chip-in-turn-on-blocked">
              {TURN_ON_BLOCKED}
            </p>
          )}
        </div>
        <label className="block max-w-xs">
          <span className="crm-label">Yearly limit per account ($)</span>
          <input name="limit" inputMode="decimal" className="crm-input" defaultValue={dollarsInput(saved?.yearlyLimitCents)} placeholder="e.g. 50.00" autoComplete="off" />
          <span className="crm-hint">From $1 to $1,000. The most one member account can chip in during one calendar year.</span>
        </label>
        <fieldset>
          <legend className="crm-label">Suggested amounts ($)</legend>
          <div className="flex flex-wrap gap-2">
            {slots.map((value, i) => (
              <input
                key={i}
                name="suggestion"
                inputMode="decimal"
                aria-label={`Suggested amount ${i + 1} in dollars`}
                className="crm-input w-28"
                defaultValue={value}
                placeholder={["e.g. 2", "e.g. 5", "e.g. 10", "optional"][i]}
                autoComplete="off"
              />
            ))}
          </div>
          <p className="crm-hint">One to four amounts, smallest first, each at least $1 and no more than the yearly limit. Leave the others empty.</p>
        </fieldset>
        <label className="block max-w-xl">
          <span className="crm-label">Reason</span>
          <input name="reason" className="crm-input" placeholder="Reason (required)" autoComplete="off" />
        </label>
      </ActionForm>
      {saved ? (
        <p className="crm-hint mt-2" data-testid="chip-in-changed">
          Last changed by {changedBy || "Weaver's team"} on {formatDate(saved.updatedAt, tz)}: {saved.reason?.trim() ? saved.reason : "no reason was recorded"}
        </p>
      ) : null}
    </>
  );
}

function figures(m: ChipInModeFigures) {
  return [
    { key: "accounts", label: "Accounts that chipped in", value: String(m.accounts) },
    { key: "collected", label: "Collected", value: formatCents(m.collectedCents, "USD") },
    { key: "refunded", label: "Refunded", value: formatCents(m.refundedCents, "USD") },
    { key: "in_flight", label: "On the way (not yet paid)", value: formatCents(m.inFlightCents, "USD") },
    { key: "at_limit", label: "Accounts at the yearly limit", value: String(m.accountsAtLimit) },
  ];
}

/** Live and test apart, no names. Test amounts are labelled and never mixed into the live column. */
function ThisYear({ overview }: { overview: ChipInOverview }) {
  const live = figures(overview.live);
  const test = figures(overview.test);
  return (
    <>
      <p className="crm-hint mb-2" data-testid="chip-in-year">
        Calendar year {overview.calendarYear} in the organization&apos;s time zone. Counts and amounts only: no names.
      </p>
      <TableWrap>
        <table className="crm-table" aria-label="Chip Ins this year">
          <thead>
            <tr>
              <th>
                <span className="sr-only">Figure</span>
              </th>
              <th>Live (real money)</th>
              <th>Test mode (sandbox, not real money)</th>
            </tr>
          </thead>
          <tbody>
            {live.map((row, i) => (
              <tr key={row.key} data-figure={row.key}>
                <td className="font-bold">{row.label}</td>
                <td data-column="live">{row.value}</td>
                <td data-column="test" className="text-muted">
                  {test[i].value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      <p className="crm-hint mt-2">Test amounts come from sandbox payments. They never count toward a real member&apos;s yearly limit and are never part of any revenue figure.</p>
    </>
  );
}

/** The estimate the organization's members' card fee follows: the standard rate, or this organization's own row, with its date and note. */
function RatesBlock({ rates, tz, centerId }: { rates: FeeRates; tz: string; centerId: string }) {
  return (
    <>
      <ul className="mb-3 space-y-1.5 text-[13px]" data-testid="chip-in-rates">
        {FEE_CLASSES.map((cls) => {
          const r = rates[cls];
          return (
            <li key={cls} data-rate={cls}>
              <span className="font-bold">{FEE_CLASS_SHORT[cls]}:</span>{" "}
              {r ? (
                <>
                  <StatusText tone={r.custom ? "warn" : "ok"}>{r.custom ? "Custom rate" : "Standard rate"}</StatusText> · {rateText(r)}
                  <span className="block text-muted">
                    {r.custom && r.effectiveFrom ? `From ${formatDate(r.effectiveFrom, tz)} · ` : ""}
                    {r.sourceNote}
                  </span>
                </>
              ) : (
                <span className="text-muted">No rate is set, so a member cannot be offered to cover this fee.</span>
              )}
            </li>
          );
        })}
      </ul>
      <p className="crm-hint mb-2">
        Only an estimate of what Stripe charges, used to work out the card fee a member may choose to cover. The fee recorded on every payment is Stripe&apos;s own. Add a custom
        rate for an organization that has its own pricing (for example approved nonprofit pricing); earlier rates stay on record, and a new row replaces the one in force.
      </p>
      <FeeRateForm centerId={centerId} submitLabel="Add a custom rate for this organization" />
    </>
  );
}
