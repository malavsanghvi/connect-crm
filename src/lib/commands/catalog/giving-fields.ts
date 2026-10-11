// Two input fields the Giving commands need that schema.ts does not have: a list of ids, and an amount of money. Built on the
// same `Field` type so they parse, describe themselves to a model and appear in the tests like every other field.

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
 * An amount in the community's currency, as text ("250", "250.00", "$1,250.50"). A plain number is accepted and turned into text. Whether it is a
 * real amount is decided by checkOfflinePayment (src/lib/payments/offline-payment.ts), which turns it into integer cents; this
 * field never does arithmetic on money.
 */
export function dollars(description: string): Field<string> {
  return {
    description,
    optional: false,
    parse(value, label) {
      if (typeof value === "number") {
        if (!Number.isFinite(value)) return bad(`${label} must be an amount, like 250.00.`);
        return { ok: true, value: String(value) };
      }
      if (typeof value !== "string") return bad(`${label} must be an amount, like 250.00.`);
      const v = value.trim();
      if (!v) return bad(`${label} is required.`);
      if (v.length > 24) return bad(`${label} can be at most 24 characters.`);
      return { ok: true, value: v };
    },
    json: () => ({ type: "string", description, maxLength: 24 }),
  };
}
