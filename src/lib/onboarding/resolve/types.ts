// Shared types for the onboarding resolve engine (pure; no database, no network, no model calls).
//
// The engine takes records from ANY source (spreadsheet rows, connector pulls, text read from a photo or PDF),
// normalises them, links them, sorts every link into a tier, and turns what is left into the fewest questions.
// Every type here is plain JSON (no Map, Set, Date or function) so the database builder can persist it as it is.

/** Where a record came from. `existing` is a household or person already in the records (a link target). */
export type SourceKind = "spreadsheet" | "connector" | "paper" | "existing";

/** What a record is. `unknown` is held: nobody guesses whether a row is a person, a household or a gift. */
export type RecordKind = "person" | "household" | "gift" | "unknown";

export type RawGift = {
  amount: unknown;
  date: unknown;
  /** A check or transaction number that is comparable across sources. */
  ref?: string | null;
  fund?: string | null;
};

/** One row as a reader hands it over. Every field is optional text; nothing here is trusted yet. */
export type RawRecord = {
  /** Unique within a run, e.g. "dir.xlsx#12". */
  id: string;
  /** The file or connection, e.g. "directory.xlsx", "neon", "bank-export.csv". */
  source: string;
  sourceKind: SourceKind;
  /** Row number in the source, 1-based. */
  row: number;
  /** 0..1, how sure a paper or photo reader was about this row. Under the threshold it is shown to a person. */
  readConfidence?: number | null;
  kind: RecordKind;

  /** The name as written ("Shah, Rahul", "Rahul & Mira Shah", "Dr. Miraben Patel nee Shah"). */
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;

  /** A number the source says is a mobile. */
  mobile?: string | null;
  phone?: string | null;
  phone2?: string | null;
  email?: string | null;
  email2?: string | null;

  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  state?: string | null;
  /** The postal code, in whatever format the country uses (ZIP, PIN, postcode, Postleitzahl ...). */
  zip?: string | null;
  /** The country of the address when the source says (an ISO code such as "GB", or a name). Else the community's own country. */
  country?: string | null;

  dob?: unknown;
  /** Identifiers by system, e.g. { family: "F-1042", neon: "N8841", quickbooks: "QB-77", connect: "0417" }. */
  ids?: Record<string, string | null | undefined>;

  /** Set for a record that is a household or person already in the records. */
  existing?: { householdId: string; personId?: string | null; number?: string | null } | null;

  // Anything that says the row is about a child. None of it may reach an AI provider (D2).
  isChild?: boolean | null;
  age?: number | null;
  role?: string | null;
  school?: string | null;
  grade?: string | null;
  /** A "Kids" column: names of children listed on an adult's row. */
  children?: string | null;
  notes?: string | null;

  gift?: RawGift | null;
};

// ---------------------------------------------------------------------------
// Normalised forms
// ---------------------------------------------------------------------------

export type Generation = "jr" | "sr" | "ii" | "iii" | "iv";

/**
 * One way of reading the words of a name: which is the given name and which the family name. A name written "Maria Garcia
 * Lopez" can be read three ways (family name Lopez, Garcia, or Garcia Lopez); "Wang Wei" and "Wei Wang" are the same two
 * words in the other order. These alternative readings are only ever a WEAK signal.
 */
export type NameReading = {
  given: string | null;
  givenKey: string | null;
  givenWeak: string | null;
  initial: string | null;
  surname: string | null;
  surnameKey: string | null;
  surnameWeak: string | null;
};

/** One person's name, split and keyed. A household-style name ("Rahul & Mira Shah") has several. */
export type NamePart = {
  /** Given name, lower-case, accents folded (ø = o, ł = l), honorifics removed. Text in another script is kept as written. Null when only an initial or nothing. */
  given: string | null;
  /** Sound-alike key for the given name (Dipak = Deepak, Mohammed = Muhammad). Other scripts are compared as written. */
  givenKey: string | null;
  /** First letter when the given name is only an initial ("R."), else the first letter of the given name. */
  initial: string | null;
  /** Keys of middle names (in this community often the father's name). */
  middleKeys: string[];
  /** The middle names as written (lower-case, folded); a Kumar between the names is an honorific and is left out. */
  middles: string[];
  surname: string | null;
  /** The family name's key. A particle belongs to it: "al-Farsi", "van der Berg" and "de la Cruz" are one family name each. */
  surnameKey: string | null;
  /** Keys of the parts of a hyphenated or double surname ("Shah-Patel" gives two). Always includes `surnameKey`'s own parts. */
  surnameParts: string[];
  /** Key of a maiden name written as "nee Shah", "(Shah)" or the first half of "Shah-Patel". Never a particle. */
  maidenKey: string | null;
  generation: Generation | null;
  /** The same given name in another language (Yusuf and Joseph share one): a hint, never proof. */
  givenWeak: string | null;
  /** The same family name in another romanisation (Zhang, Cheung and Chang share one): a hint, never proof. */
  surnameWeak: string | null;
  /** Other readings of the same words (family name first, a double surname's halves, a nickname, a native-script spelling). Weak. */
  alts: NameReading[];
};

export type NormalizedName = {
  raw: string;
  people: NamePart[];
  /** The name has letters in another script (Gujarati, Arabic, Han ...). They are compared as written, never dropped. */
  nonLatin: boolean;
  /** A title that says "child" ("Master", "Baby"). */
  minorHint: boolean;
  /** Nothing usable was found. */
  missing: boolean;
};

export type PhoneValue = { value: string; mobile: boolean };

export type ParsedAddress = {
  number: string | null;
  predir: string | null;
  street: string | null;
  suffix: string | null;
  postdir: string | null;
  unit: string | null;
  city: string | null;
  state: string | null;
  /** The postal code as a comparison key: a US ZIP's five digits, "sw1a1aa", "400001" ... */
  zip5: string | null;
  /** The four digits after a US ZIP, or null. */
  zip4: string | null;
  poBox: boolean;
  /** House number + street name, no ZIP, no unit: the blocking key. */
  streetKey: string;
};

export type ParsedDate = {
  /** The date when it can be read one way only. Null when ambiguous, unreadable or blank. */
  iso: string | null;
  /** All readings of the text ("03/04/1987" has two when the order is unknown). */
  alternatives: string[];
  /** Day and month could be swapped: flagged, never guessed. */
  ambiguous: boolean;
  twoDigitYear: boolean;
  /** Years of the readings that are possible (one unless the two-digit year is ambiguous). */
  years: number[];
  problem: string | null;
};

export type MoneyProblem = "blank" | "unreadable" | "zero" | "negative";

export type NormalizedGift = {
  cents: number | null;
  problem: MoneyProblem | null;
  date: ParsedDate;
  ref: string | null;
  fund: string | null;
};

export type MinorReason = "flag" | "age" | "birth_date" | "role" | "school_or_grade" | "title";

export type NormalizedRecord = {
  id: string;
  source: string;
  sourceKind: SourceKind;
  row: number;
  /** Position in the input, used to tell which row "arrived" later. */
  order: number;
  kind: RecordKind;
  readConfidence: number | null;
  name: NormalizedName;
  phones: PhoneValue[];
  emails: string[];
  address: ParsedAddress | null;
  dob: ParsedDate | null;
  /** Identifiers by system, normalised for comparing (case, spaces, leading zeros). */
  ids: Record<string, string>;
  existing: RawRecord["existing"];
  gift: NormalizedGift | null;
  minor: { isMinor: boolean; reasons: MinorReason[] };
  /** The kind cannot be trusted: "unknown", or the gift fields disagree with the kind. */
  typeUncertain: boolean;
  /** Names of things that were unreadable, kept for the report ("phone", "email", "date of birth"...). */
  problems: string[];
  /** Short content hash, stable across runs, used to recognise the same record again. Not the data itself. */
  fingerprint: string;
};

// ---------------------------------------------------------------------------
// Evidence, pairs, tiers
// ---------------------------------------------------------------------------

export type EvidenceKind =
  | "id"
  | "phone"
  | "email"
  | "address"
  | "dob"
  | "name"
  | "surname_zip"
  | "household_name"
  | "gift_amount"
  | "gift_date"
  | "gift_ref";

export type Evidence = {
  kind: EvidenceKind;
  /** Counts toward "two independent identifiers". Names, surname + ZIP and the gift amount never do on their own. */
  independent: boolean;
  points: number;
  /** Plain English, e.g. "same mobile", "same address, different unit", "e-mail matches", "ID matches". */
  label: string;
  /**
   * Belongs to one person (a mobile, an e-mail, a birth date, a person's ID), as opposed to a whole household (an address, a
   * landline, a family number). Relatives share the second kind, so it can say "same household" but not "same person".
   */
  personal?: boolean;
};

export type ConflictKind = "id" | "birth_year" | "birth_date" | "generation" | "one_sided_generation" | "ambiguous_name" | "unit" | "unit_missing" | "middle_name" | "gift_ref";

export type Conflict = {
  kind: ConflictKind;
  /** `block` never lets a link be automatic; `lower` moves it down one step. */
  severity: "block" | "lower";
  label: string;
};

/** `weak`: the names agree only through another reading (words in the other order, a double surname's half, a translated first name). */
export type NameLevel = "match" | "maiden" | "weak" | "surname_only" | "given_only" | "different" | "unknown";

export type Strength = "strong" | "medium" | "weak";

export type Relation = "same_person" | "same_household" | "same_gift";

export type Tier = "A" | "B" | "C" | "D";

export type HoldReason = "minor" | "money_conflict" | "uncertain_type" | "unreadable_money";

export type PatternSignature =
  | "spouse_maiden_name"
  | "shared_phone_households"
  | "address_unit_differs"
  | "shared_email_households"
  | "name_only"
  | "birth_year_differs"
  | "ids_differ"
  | "id_name_differs"
  | "duplicate_gift_two_sources"
  | "low_confidence_read"
  | "linked_through_another_record"
  | "amount_differs_cents"
  | "amount_differs"
  | "minor_record"
  | "uncertain_type"
  | "unreadable_money";

export type GiftMoney = { kind: "amount_differs_cents" | "amount_differs"; aCents: number; bCents: number };

/** Two records that might be the same person, household or gift. `a` is the earlier record in the input. */
export type CandidatePair = {
  a: string;
  b: string;
  relation: Relation;
  strength: Strength;
  /** 0..100, for sorting. The tier rules use the counts, not this number alone. */
  score: number;
  /** How many independent identifier families agree (phone, e-mail, address, ID, birth date, gift reference). */
  independent: number;
  evidence: Evidence[];
  conflicts: Conflict[];
  nameLevel: NameLevel;
  /** Nothing but a name (and perhaps a ZIP) agrees. Such a pair is never better than weak. */
  nameOnly: boolean;
  /** Blocking keys that surfaced the pair. */
  viaKeys: string[];
  /** Set on a gift pair whose amounts disagree. */
  money: GiftMoney | null;
};

export type ClassifiedPair = CandidatePair & {
  tier: Tier;
  tierReasons: string[];
  hold: HoldReason | null;
  signature: PatternSignature | null;
  /** The records that need a person because of this pair (empty for tier A and for an implied pair). */
  affected: string[];
  /**
   * The two records ended up in one cluster through OTHER, stronger links, so this weaker pair adds nothing to ask about
   * (a gift linked to one spouse is already in the household of the other).
   */
  implied: boolean;
};

export type Hub = { key: string; size: number };

/** Records that were linked automatically. */
export type Cluster = {
  id: string;
  recordIds: string[];
  /** Households already in the records that this cluster lands in. More than one is never merged here. */
  existing: string[];
};

export type RecordStatus = "auto" | "bulk" | "asked" | "held" | "learned";

export type RecordDisposition = {
  id: string;
  status: RecordStatus;
  /** `linked` joined something automatically, `new` has no candidates at all. */
  how: "linked" | "new" | "duplicate_gift" | "review" | "question" | "hold" | "rule";
  tier: Tier | null;
  clusterId: string | null;
};
