// What Giving's Pledges and Payments lists draw (docs/GIVING_REDESIGN.md section 4, slice 3). Pure types shared by the row
// builders, the loader, the dev preview and the tests.

import type { CardLabels } from "@/components/household-card";
import type { Act, Family } from "@/lib/giving-today/queue";

export type Tone = "ok" | "warn" | "bad" | "info" | "muted";

/** What the person may do (UI convenience: the database refuses the rest anyway). */
export type ListCan = { manage: boolean; approve: boolean; record: boolean; allocate: boolean; bankConfirm: boolean };

export type ListContext = {
  /** The person looking: a request they made is approved by someone else. */
  me: string;
  can: ListCan;
  currency: string;
  locale: string;
  timeZone: string;
  today: string;
  labels: CardLabels;
  /** PayPal is connected by its Business email only: its refunds are made in PayPal and recorded here by hand. */
  paypalEmailOnly: boolean;
};

/**
 * One row of a list: a table row on a computer, a card on a phone. `family`, `title` and `lines` are what an in-row sheet repeats
 * (the household card, then the evidence), so a row acts exactly as a Today row does.
 */
export type ListRow = {
  id: string;
  /** Receipt or pledge number, or the bank reference. */
  reference: string;
  family: Family | null;
  title: string;
  lines: string[];
  amount: string;
  amountNote: string | null;
  date: string;
  status: { label: string; tone: Tone };
  /** A plain sentence about who acts next ("You asked for this write-off; a different person approves it."). */
  note: string | null;
  /** Why the search found it. */
  found: string | null;
  /** The buttons shown on the row (what its state asks for). */
  primary: Act[];
  /** The row menu (⋯). */
  menu: Act[];
  history: { table: "pledges" | "payments" | "recurring_gifts"; title: string } | null;
};

export type Chip = { key: string; label: string; href: string; count: number | null; on: boolean };
