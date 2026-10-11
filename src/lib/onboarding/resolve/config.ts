// Every threshold of the resolve engine in ONE object. Nothing else in resolve/ holds a magic number.
// The engine reads no clock: `today` is part of the config, so the same rows always give the same result.

export type ResolveConfig = {
  /** YYYY-MM-DD in the community's time zone. Decides who is under 18 and how two-digit years are read. */
  today: string;
  /** Country code for phone numbers without one ("1" = US). */
  defaultCountry: string;
  /** The date order of the file when a reader has found proof; "unknown" flags every day/month ambiguity. */
  dateOrder: "mdy" | "dmy" | "unknown";
  /** The date order found for each source (see detectDateOrder); a source not listed uses `dateOrder`. */
  dateOrderBySource: Record<string, "mdy" | "dmy">;
  /** Anyone younger than this is held (decision D2 and tier D). */
  minorAge: number;
  /** A paper or photo read under this confidence is shown to a person. */
  minReadConfidence: number;

  /** Points each kind of agreement adds to a pair's score (0..100). */
  weights: {
    id: number;
    phone: number;
    email: number;
    address: number;
    dob: number;
    giftRef: number;
    /** The same amount on (nearly) the same date. */
    giftAmount: number;
    nameMatch: number;
    /** A spelling variant or a one-letter slip of the same name. */
    nameVariant: number;
    /** Only an initial and the family name agree. */
    nameInitial: number;
    nameMaiden: number;
    nameSurnameOnly: number;
    surnameZip: number;
    /** The same family name at the same street address (only when `tier.familyNameAtAddress` is on). */
    familyAtAddress: number;
    /** Taken off for each `lower` conflict. */
    lowerConflict: number;
  };

  tier: {
    /** Tier A: at least this many independent identifiers agree, the score is at least `autoMinScore`, nothing conflicts. */
    autoMinIdentifiers: number;
    autoMinScore: number;
    /** Tier B: at least this many agree and the names do not contradict. */
    bulkMinIdentifiers: number;
    /** A pair scoring under this is dropped, not asked about. */
    askMinScore: number;
    /**
     * For two DIFFERENT people (household members), the same street address and the same family name count as two independent
     * pieces of evidence, as the existing smart matching does. Never for an address shared by several units or families, never
     * with a unit conflict, never for "same person". Turn off to send every such pair to bulk review.
     */
    familyNameAtAddress: boolean;
  };

  blocking: {
    /** A key shared by more records than this is a hub: reported, not compared pair by pair. */
    maxBlockSize: number;
    /** A phone, e-mail or address shared by more records than this is not evidence (an office line, a temple). */
    hubSize: number;
  };

  names: {
    /** Surname and given-name keys this long or longer may differ by one letter (Sanghvi / Sanghavi). */
    closeMinLength: number;
  };

  gifts: {
    /** Two gifts this many days apart (or fewer) may be the same gift seen by two sources. */
    dateWindowDays: number;
    /** Amounts this close (in cents) but not equal are "differs by cents". */
    centsTolerance: number;
  };

  budget: {
    /** The target: questions after grouping per 1,000 rows. */
    questionsPer1000: number;
    secondsPerQuestion: number;
    /** A bulk row is skimmed, not studied: it is sorted by evidence and approved with "approve all". */
    secondsPerBulkRow: number;
    /** A held gift (money) is checked on its own. */
    secondsPerHeldMoneyItem: number;
    /** Any other held row (a child, an unknown kind) is glanced at; adding it to a family happens outside the inbox. */
    secondsPerHeldOtherItem: number;
    /** The promise: minutes of a person's time per 1,000 rows. */
    minutesPer1000: number;
  };
};

export const DEFAULT_CONFIG: Omit<ResolveConfig, "today"> = {
  defaultCountry: "1",
  dateOrder: "unknown",
  dateOrderBySource: {},
  minorAge: 18,
  minReadConfidence: 0.9,
  weights: {
    id: 55,
    phone: 40,
    email: 40,
    address: 38,
    dob: 34,
    giftRef: 40,
    giftAmount: 20,
    nameMatch: 20,
    nameVariant: 14,
    nameInitial: 8,
    nameMaiden: 14,
    nameSurnameOnly: 6,
    surnameZip: 4,
    familyAtAddress: 30,
    lowerConflict: 25,
  },
  tier: { autoMinIdentifiers: 2, autoMinScore: 70, bulkMinIdentifiers: 1, askMinScore: 12, familyNameAtAddress: true },
  blocking: { maxBlockSize: 40, hubSize: 12 },
  names: { closeMinLength: 5 },
  gifts: { dateWindowDays: 3, centsTolerance: 99 },
  budget: { questionsPer1000: 10, secondsPerQuestion: 30, secondsPerBulkRow: 2, secondsPerHeldMoneyItem: 30, secondsPerHeldOtherItem: 1, minutesPer1000: 10 },
};

export type ConfigOverrides = {
  [K in Exclude<keyof Omit<ResolveConfig, "today">, "dateOrderBySource">]?: ResolveConfig[K] extends object ? Partial<ResolveConfig[K]> : ResolveConfig[K];
} & { dateOrderBySource?: Record<string, "mdy" | "dmy"> };

/** The defaults plus any overrides. `today` is required: the engine never reads the clock. */
export function makeConfig(today: string, overrides: ConfigOverrides = {}): ResolveConfig {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error(`makeConfig: today must be YYYY-MM-DD, got "${today}"`);
  const d = DEFAULT_CONFIG;
  return {
    today,
    defaultCountry: overrides.defaultCountry ?? d.defaultCountry,
    dateOrder: overrides.dateOrder ?? d.dateOrder,
    dateOrderBySource: { ...d.dateOrderBySource, ...overrides.dateOrderBySource },
    minorAge: overrides.minorAge ?? d.minorAge,
    minReadConfidence: overrides.minReadConfidence ?? d.minReadConfidence,
    weights: { ...d.weights, ...overrides.weights },
    tier: { ...d.tier, ...overrides.tier },
    blocking: { ...d.blocking, ...overrides.blocking },
    names: { ...d.names, ...overrides.names },
    gifts: { ...d.gifts, ...overrides.gifts },
    budget: { ...d.budget, ...overrides.budget },
  };
}
