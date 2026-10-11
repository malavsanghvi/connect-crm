// A tiny input validator for commands. No dependency: a command says what it takes with these builders, and the same description
// serves three readers: the screen (parse), the model (a JSON schema for the tool list) and the tests. Every problem is a
// sentence for a person ("Venue can be at most 200 characters."), never a code.

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export type JsonSchemaProp = { type: "string" | "integer" | "boolean"; description: string; enum?: readonly string[]; format?: string; minLength?: number; maxLength?: number; minimum?: number; maximum?: number; default?: unknown };

/** One input field: how to read it, and how to describe it to a model. */
export type Field<T> = {
  readonly description: string;
  /** True when the field may be left out (its value is then undefined, or the default). */
  readonly optional: boolean;
  /**
   * True for a value the command itself works out when it prepares a confirmation (`resolve`) and stores in the proposal: it is
   * accepted when a confirmed proposal runs, but it is not offered to a model or the palette, and a value given for it is replaced.
   */
  readonly hidden?: boolean;
  parse(value: unknown, label: string): Parsed<T>;
  json(): JsonSchemaProp;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** YYYY-MM-DD that exists on the calendar (not 2026-02-31, which a Date would roll over to March). */
function isRealDate(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

function bad(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function stringField(description: string, opts: { min?: number; max?: number; format?: string; check?: (v: string, label: string) => string | null } = {}): Field<string> {
  const min = opts.min ?? 0;
  const max = opts.max ?? 500;
  return {
    description,
    optional: false,
    parse(value, label) {
      if (typeof value !== "string") return bad(`${label} must be text.`);
      // Collapse stray control characters (a model can paste anything); keep ordinary line breaks.
      const v = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim();
      if (v.length < min) return bad(min <= 1 ? `${label} is required.` : `${label} must be at least ${min} characters.`);
      if (Array.from(v).length > max) return bad(`${label} can be at most ${max} characters.`);
      const problem = opts.check?.(v, label);
      if (problem) return bad(problem);
      return { ok: true, value: v };
    },
    json: () => ({ type: "string", description, minLength: min || undefined, maxLength: max, ...(opts.format ? { format: opts.format } : {}) }),
  };
}

export const f = {
  /** Free text, trimmed. `min` 1 makes it required to be non-empty; `min` 0 allows an empty string (used to clear a value). */
  string(description: string, opts: { min?: number; max?: number } = {}): Field<string> {
    return stringField(description, { min: opts.min ?? 1, max: opts.max });
  },
  /** An id of a record (uuid). */
  uuid(description: string): Field<string> {
    return stringField(description, {
      min: 1,
      max: 36,
      format: "uuid",
      check: (v, label) => (UUID.test(v) ? null : `${label} is not a valid id.`),
    });
  },
  /** A calendar date, YYYY-MM-DD. */
  date(description: string): Field<string> {
    return stringField(description, {
      min: 1,
      max: 10,
      format: "date",
      check: (v, label) => (isRealDate(v) ? null : `${label} must be a date like 2026-10-25.`),
    });
  },
  /** One of a fixed list of words. */
  enum<const V extends readonly [string, ...string[]]>(description: string, values: V): Field<V[number]> {
    return {
      description,
      optional: false,
      parse(value, label) {
        if (typeof value !== "string" || !(values as readonly string[]).includes(value.trim())) {
          return bad(`${label} must be one of: ${values.join(", ")}.`);
        }
        return { ok: true, value: value.trim() as V[number] };
      },
      json: () => ({ type: "string", description, enum: values }),
    };
  },
  /** A whole number. Money is never entered here: amounts are integer cents in their own commands. */
  integer(description: string, opts: { min?: number; max?: number } = {}): Field<number> {
    return {
      description,
      optional: false,
      parse(value, label) {
        const n = typeof value === "string" && /^-?\d+$/.test(value.trim()) ? Number(value.trim()) : value;
        if (typeof n !== "number" || !Number.isInteger(n)) return bad(`${label} must be a whole number.`);
        if (opts.min !== undefined && n < opts.min) return bad(`${label} must be at least ${opts.min}.`);
        if (opts.max !== undefined && n > opts.max) return bad(`${label} must be at most ${opts.max}.`);
        return { ok: true, value: n };
      },
      json: () => ({ type: "integer", description, minimum: opts.min, maximum: opts.max }),
    };
  },
  boolean(description: string): Field<boolean> {
    return {
      description,
      optional: false,
      parse(value, label) {
        if (typeof value === "boolean") return { ok: true, value };
        if (value === "true" || value === "yes") return { ok: true, value: true };
        if (value === "false" || value === "no") return { ok: true, value: false };
        return bad(`${label} must be yes or no.`);
      },
      json: () => ({ type: "boolean", description }),
    };
  },
  /** The field may be left out. */
  optional<T>(field: Field<T>): Field<T | undefined> {
    return { ...field, optional: true, parse: (value, label) => (value === undefined || value === null ? { ok: true, value: undefined } : field.parse(value, label)) };
  },
  /** The field may be left out, and is `fallback` when it is. */
  withDefault<T>(field: Field<T>, fallback: T): Field<T> {
    return {
      ...field,
      optional: true,
      parse: (value, label) => (value === undefined || value === null ? { ok: true, value: fallback } : field.parse(value, label)),
      json: () => ({ ...field.json(), default: fallback }),
    };
  },
};

// ---------------------------------------------------------------------------
// Objects
// ---------------------------------------------------------------------------
type Shape = Record<string, Field<unknown>>;
type FieldValue<F> = F extends Field<infer T> ? T : never;
type OptionalKeys<S extends Shape> = { [K in keyof S]: undefined extends FieldValue<S[K]> ? K : never }[keyof S];
type Flatten<T> = { [K in keyof T]: T[K] } & {};
export type InputOf<S extends Shape> = Flatten<{ [K in Exclude<keyof S, OptionalKeys<S>>]: FieldValue<S[K]> } & { [K in OptionalKeys<S>]?: FieldValue<S[K]> }>;

export type JsonObjectSchema = {
  type: "object";
  properties: Record<string, JsonSchemaProp>;
  required: string[];
  additionalProperties: false;
};

export type ObjectSchema<T> = {
  readonly shape: Shape;
  /** Read an input. Unknown keys are refused, not ignored: a model must not smuggle in a value the command does not take. */
  parse(value: unknown): Parsed<T>;
  /** The JSON schema for a model's tool list. */
  json(): JsonObjectSchema;
  /** Field names, in order. */
  keys(): string[];
};

/** Human label for a field name: "starts_at" → "Starts at", "event_id" → "Event". */
export function fieldLabel(name: string): string {
  const base = name.replace(/_id$/, "").replace(/_/g, " ").trim();
  return base ? base[0].toUpperCase() + base.slice(1) : name;
}

/** The input type of an object schema: `Infer<typeof input>`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Infer<S extends ObjectSchema<any>> = S extends ObjectSchema<infer T> ? T : never;

export function object<S extends Shape>(shape: S): ObjectSchema<InputOf<S>> {
  return {
    shape,
    keys: () => Object.keys(shape),
    parse(value) {
      const raw = value === undefined || value === null ? {} : value;
      if (typeof raw !== "object" || Array.isArray(raw)) return bad("The details for this action must be a set of named values.");
      const input = raw as Record<string, unknown>;
      const unknown = Object.keys(input).filter((k) => !(k in shape));
      if (unknown.length > 0) return bad(`This action does not take ${unknown.map((k) => `"${k}"`).join(" or ")}.`);
      const out: Record<string, unknown> = {};
      for (const [name, field] of Object.entries(shape)) {
        const given = input[name];
        if (given === undefined || given === null) {
          if (!field.optional) return bad(`${fieldLabel(name)} is required.`);
        }
        const parsed = field.parse(given, fieldLabel(name));
        if (!parsed.ok) return parsed;
        if (parsed.value !== undefined) out[name] = parsed.value;
      }
      return { ok: true, value: out as InputOf<S> };
    },
    json() {
      const properties: Record<string, JsonSchemaProp> = {};
      const required: string[] = [];
      for (const [name, field] of Object.entries(shape)) {
        if (field.hidden) continue;
        properties[name] = field.json();
        if (!field.optional) required.push(name);
      }
      return { type: "object", properties, required, additionalProperties: false };
    },
  };
}
