// Two input fields the Giving commands need that schema.ts does not have: a list of ids, and an amount of dollars. Built on the
// same `Field` type so they parse, describe themselves to a model and appear in the tests like every other field.

import type { PlannedLine } from "@/lib/payments/payment-draft";

import type { Field, Parsed } from "../schema";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bad = (error: string): Parsed<never> => ({ ok: false, error });

/** Ids of records, as a list or as text separated by commas or spaces. Duplicates are dropped, order is kept. */
export function uuidList(description: string, opts: { max: number }): Field<string[]> {
  return {
    description,
    optional: false,
    parse(value, label) {
      let parts: unknown[];
      if (Array.isArray(value)) parts = value;
      else if (typeof value === "string") parts = value.split(/[\s,;]+/).filter(Boolean);
      else return bad(`${label} must be a list of ids.`);
      const ids: string[] = [];
      for (const part of parts) {
        if (typeof part !== "string" || !UUID.test(part.trim())) return bad(`${label} has something that is not a valid id.`);
        const id = part.trim().toLowerCase();
        if (!ids.includes(id)) ids.push(id);
      }
      if (ids.length === 0) return bad(`${label} needs at least one id.`);
      if (ids.length > opts.max) return bad(`${label} can have at most ${opts.max} ids.`);
      return { ok: true, value: ids };
    },
    json: () => ({ type: "string", description: `${description} Separate ids with commas.` }),
  };
}

/**
 * An amount in dollars, as text ("250", "250.00", "$1,250.50"). A plain number is accepted and turned into text. Whether it is a
 * real amount is decided by checkOfflinePayment (src/lib/payments/offline-payment.ts), which turns it into integer cents; this
 * field never does arithmetic on money.
 */
export function dollars(description: string): Field<string> {
  return {
    description,
    optional: false,
    parse(value, label) {
      if (typeof value === "number") {
        if (!Number.isFinite(value)) return bad(`${label} must be an amount in dollars, like 250.00.`);
        return { ok: true, value: String(value) };
      }
      if (typeof value !== "string") return bad(`${label} must be an amount in dollars, like 250.00.`);
      const v = value.trim();
      if (!v) return bad(`${label} is required.`);
      if (v.length > 24) return bad(`${label} can be at most 24 characters.`);
      return { ok: true, value: v };
    },
    json: () => ({ type: "string", description, maxLength: 24 }),
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const whole = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

/** A whole number of cents that the command works out itself (the amount, once read). Not offered to a model; a value given for it is replaced. */
export function hiddenCents(description: string): Field<number | undefined> {
  return {
    description,
    optional: true,
    hidden: true,
    parse(value, label) {
      if (value === undefined || value === null) return { ok: true, value: undefined };
      return whole(value) ? { ok: true, value } : bad(`${label} must be a whole number of cents.`);
    },
    json: () => ({ type: "integer", description }),
  };
}

/**
 * The pledges a payment will be applied to, as the confirmation card showed them: which pledge, how much, and what the pledge looked
 * like then. The command works this out when it prepares the confirmation and the database runs exactly this. Not offered to a model.
 */
export function hiddenPlan(description: string): Field<PlannedLine[] | undefined> {
  return {
    description,
    optional: true,
    hidden: true,
    parse(value, label) {
      if (value === undefined || value === null) return { ok: true, value: undefined };
      if (!Array.isArray(value) || value.length > 50) return bad(`${label} must be a short list.`);
      const lines: PlannedLine[] = [];
      for (const raw of value) {
        if (!isRecord(raw) || typeof raw.pledge_id !== "string" || !UUID.test(raw.pledge_id)) return bad(`${label} has a pledge that is not valid.`);
        if (!whole(raw.amount_cents) || raw.amount_cents <= 0 || !whole(raw.pledge_amount_cents) || !whole(raw.pledge_paid_cents)) return bad(`${label} has an amount that is not valid.`);
        lines.push({ pledge_id: raw.pledge_id.toLowerCase(), amount_cents: raw.amount_cents, pledge_amount_cents: raw.pledge_amount_cents, pledge_paid_cents: raw.pledge_paid_cents });
      }
      return { ok: true, value: lines };
    },
    json: () => ({ type: "string", description }),
  };
}
