// DEV ONLY. Invented payment proofs for the Giving > Payment proofs preview (src/app/dev/giving-proofs): the four screens of the
// prototype (a check with a bank line waiting, cash, a possible duplicate, a proof above the two-person limit) and one proof that
// waits for the family's answer. Invented names and ids; nothing here is a real family.

import { parseProofQueue, type ProofCard } from "@/lib/payment-proofs/queue";

const svg = (label: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200"><rect width="320" height="200" fill="whitesmoke"/><rect x="18" y="16" width="224" height="150" rx="6" fill="white" stroke="lightsteelblue"/><rect x="30" y="30" width="120" height="6" fill="lavender"/><rect x="30" y="50" width="190" height="6" fill="lavender"/><rect x="30" y="70" width="150" height="6" fill="lavender"/><rect x="30" y="140" width="160" height="10" fill="lavender"/><text x="12" y="190" font-family="sans-serif" font-size="12" fill="gray">${label}</text></svg>`,
  )}`;

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const household = (n: number, name: string, number: string, org: string, members: string, zone: string, city: string, open: number) => ({
  household_id: id(100 + n),
  household_name: name,
  household_number: number,
  org_household_id: org,
  members,
  primary_member: members.split(",")[0],
  primary_org_member_id: `M-${org}`,
  zone,
  city,
  last_gift_on: "2026-09-02",
  open_pledge_cents: open,
});

const file = (n: number, type = "image/png") => ({ id: id(200 + n), storage_path: `dev/${n}.png`, content_type: type, bytes: 120000, removed: false, created_at: "2026-10-12T15:00:00Z" });

const base = {
  entry: "open_pledges",
  note: null,
  excess_cents: 0,
  question: null,
  events: [{ kind: "submitted", body: "Sent for checking. Your pledges show Soft credit until the treasury team checks it.", created_at: "2026-10-12T15:00:00Z" }],
  lookalikes: [],
  same_file: false,
  bank_lines: [],
  needs_second: false,
  first_approved: false,
  first_approved_by_me: false,
  own_household: false,
  stale: false,
  is_test: false,
};

export function sampleProofCards(): ProofCard[] {
  const cards = parseProofQueue([
    {
      ...base,
      id: id(1),
      household_id: id(101),
      status: "submitted",
      method: "check",
      amount_cents: 25000,
      paid_on: "2026-10-12",
      reference: "1048",
      created_at: "2026-10-12T15:00:00Z",
      age_days: 3,
      household: household(1, "Okafor household", "H-1042", "2210", "Adaeze O., Chidi O.", "Eastside", "Riverbend", 31000),
      covered: [
        { pledge_id: id(301), pledge_number: "P-0587", title: "Harvest supper, 4 seats", amount_cents: 16000, pledge_amount_cents: 16000, state: "active" },
        { pledge_id: id(302), pledge_number: "P-0601", title: "Building fund", amount_cents: 9000, pledge_amount_cents: 30000, state: "active" },
      ],
      files: [file(1), file(2)],
      bank_lines: [{ id: id(401), posted_on: "2026-10-14", description: "CHECK 1048" }],
    },
    {
      ...base,
      id: id(2),
      household_id: id(102),
      status: "submitted",
      method: "cash",
      amount_cents: 7500,
      paid_on: "2026-10-11",
      reference: "Receipt 214",
      created_at: "2026-10-11T10:00:00Z",
      age_days: 4,
      household: household(2, "Patel household", "H-0377", "0377", "Meera P., Anil P.", "Westgate", "Riverbend", 7500),
      covered: [{ pledge_id: id(303), pledge_number: "P-0640", title: "Food drive sponsorship", amount_cents: 7500, pledge_amount_cents: 7500, state: "active" }],
      files: [file(3, "application/pdf")],
    },
    {
      ...base,
      id: id(3),
      household_id: id(103),
      status: "submitted",
      method: "check",
      amount_cents: 20000,
      paid_on: "2026-10-09",
      reference: "2290",
      created_at: "2026-10-09T09:00:00Z",
      age_days: 8,
      household: household(3, "Nguyen household", "H-0911", "0911", "Linh N.", "Northfield", "Riverbend", 20000),
      covered: [{ pledge_id: id(304), pledge_number: "P-0577", title: "Annual fund", amount_cents: 20000, pledge_amount_cents: 20000, state: "active" }],
      files: [file(4)],
      lookalikes: [{ kind: "payment", id: id(501), label: "Receipt R-2291, check, Oct 6", certain: false }],
      same_file: true,
    },
    {
      ...base,
      id: id(4),
      household_id: id(104),
      status: "submitted",
      method: "ach",
      amount_cents: 300000,
      paid_on: "2026-10-13",
      reference: "trace 88213",
      created_at: "2026-10-13T12:00:00Z",
      age_days: 2,
      household: household(4, "Mensah household", "H-1288", "1288", "Kofi M., Ama M.", "Eastside", "Riverbend", 300000),
      covered: [{ pledge_id: id(305), pledge_number: "P-0602", title: "Building fund", amount_cents: 300000, pledge_amount_cents: 300000, state: "active" }],
      files: [file(5), file(6)],
      needs_second: true,
    },
    {
      ...base,
      id: id(5),
      household_id: id(105),
      status: "needs_info",
      method: "check",
      amount_cents: 12000,
      paid_on: "2026-09-20",
      reference: "0771",
      created_at: "2026-09-21T12:00:00Z",
      age_days: 24,
      question: "Could you send a clearer photo of the front of the check?",
      stale: true,
      household: household(5, "Shah household", "H-0150", "0150", "Rahul S., Mira S.", "Westgate", "Riverbend", 12000),
      covered: [{ pledge_id: id(306), pledge_number: "P-0555", title: "Annual fund", amount_cents: 12000, pledge_amount_cents: 12000, state: "active" }],
      files: [file(7)],
    },
  ]);
  if (!cards) throw new Error("sample proofs did not parse");
  // The page makes short-lived links; the preview draws a stand-in picture instead.
  for (const c of cards) for (const f of c.files) f.url = f.kind === "pdf" ? null : svg(`Proof file ${f.id.slice(-2)}`);
  return cards;
}
