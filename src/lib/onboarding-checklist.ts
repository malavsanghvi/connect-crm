// The "get ready" checklist an organization can download from the website before onboarding: what to have at hand so
// setup can be finished quickly. A plain CSV (opens in Excel and Google Sheets) with a blank "Ready?" column. It never
// asks for a password: connections are made by signing in to the other service from Weaver.

export type ChecklistRow = { area: string; item: string; why: string; format: string; who: string };

/** The areas, in order, with the one line the homepage shows for each. */
export const CHECKLIST_AREAS: readonly { area: string; line: string }[] = [
  { area: "Connections", line: "QuickBooks, your bank, card and PayPal, Zelle, text messaging and email." },
  { area: "People and data", line: "Members and households, donors and giving history, funds, pledges, your team." },
  { area: "Forms", line: "Membership, registration, waiver, volunteer and youth-safety forms." },
  { area: "Calendars", line: "Your events, recurring programs, special days and closures." },
  { area: "Legal and tax", line: "IRS letter, bylaws, officers, receipt wording, privacy and refund policies." },
  { area: "Look and feel", line: "Logo, colors, welcome message, photos and contact details." },
];

export const CHECKLIST: readonly ChecklistRow[] = [
  { area: "Connections", item: "QuickBooks Online company", why: "To post gifts, fees and deposits to your books", format: "An Intuit login with administrator rights (you sign in to Intuit yourself; we never ask for your password)", who: "Treasurer or bookkeeper" },
  { area: "Connections", item: "Your chart of accounts", why: "To choose the income, fee, clearing and bank accounts each fund posts to", format: "A list or export of your accounts", who: "Treasurer or bookkeeper" },
  { area: "Connections", item: "Bank accounts that receive deposits", why: "To match deposits to gifts", format: "Which accounts, and the name each has in QuickBooks", who: "Treasurer" },
  { area: "Connections", item: "Card and PayPal accounts (optional)", why: "To take online payments", format: "Your Stripe and/or PayPal business account", who: "Treasurer" },
  { area: "Connections", item: "Zelle details (optional)", why: "To show members where to send Zelle payments", format: "The Zelle address or phone, the name shown in Zelle and the bank account it lands in", who: "Treasurer" },
  { area: "Connections", item: "Phone number for text messages (optional)", why: "To text members from your own number", format: "The number you will send from", who: "Administrator" },
  { area: "Connections", item: "Email address you send from (optional)", why: "So messages come from your organization", format: "The address, and who manages your domain", who: "Administrator" },
  { area: "Connections", item: "Website and social accounts (optional)", why: "To link and, later, publish events", format: "Your website address and your Facebook and Instagram pages", who: "Communications lead" },
  { area: "People and data", item: "Member and household list", why: "To bring everyone in with their family", format: "CSV or Excel: names, email, phone, address, household members, join date, membership type", who: "Membership lead" },
  { area: "People and data", item: "Identifiers you use today", why: "Every member keeps all of their numbers", format: "Member numbers and IDs from your other systems, one column each", who: "Membership lead" },
  { area: "People and data", item: "Your team and their roles", why: "To give the right people the right access", format: "Name, email, role; at least an administrator, a second administrator and a treasurer", who: "President or administrator" },
  { area: "People and data", item: "Giving history", why: "To bring donors and their history in", format: "CSV or Excel: date, donor, amount, fund, payment method (up to seven years)", who: "Treasurer" },
  { area: "People and data", item: "Open pledges and balances", why: "To carry unpaid pledges forward", format: "Donor, pledge date, amount, amount paid, fund", who: "Treasurer" },
  { area: "People and data", item: "Funds and campaigns", why: "To set up where gifts are recorded", format: "Names, purpose, and the QuickBooks account each belongs to", who: "Treasurer" },
  { area: "People and data", item: "Membership types and prices", why: "To set up dues and renewals", format: "Each type, price, period and who it covers", who: "Membership lead" },
  { area: "People and data", item: "Classes and school (if you have one)", why: "To set up levels, terms, fees and rosters", format: "Levels, terms, fees, teachers and student lists", who: "School coordinator" },
  { area: "People and data", item: "Store products (if you have a store)", why: "To list what you sell", format: "Name, price, photo, pickup windows", who: "Store lead" },
  { area: "Forms", item: "Membership application and renewal forms", why: "To bring your process online", format: "The forms you use today", who: "Membership lead" },
  { area: "Forms", item: "Event registration forms and waivers", why: "To collect what you need at sign-up", format: "The forms and any photo-consent wording", who: "Events lead" },
  { area: "Forms", item: "Volunteer forms", why: "To onboard volunteers", format: "Sign-up form and any screening policy", who: "Volunteer coordinator" },
  { area: "Forms", item: "Youth and child-safety policy", why: "To protect children in your programs", format: "Your written policy", who: "Board or administrator" },
  { area: "Calendars", item: "Annual events calendar", why: "To publish your year", format: "Event name, date, time, place, ticket price", who: "Events lead" },
  { area: "Calendars", item: "Recurring programs", why: "To set up weekly and monthly activities", format: "Name, day, time, place, who leads it", who: "Program leads" },
  { area: "Calendars", item: "Special days and occasions you observe", why: "To remind members at the right moment", format: "Date, name, and who should be prompted", who: "Administrator" },
  { area: "Calendars", item: "Closures and holidays", why: "So the calendar and notices are right", format: "Dates and what is closed", who: "Administrator" },
  { area: "Legal and tax", item: "IRS determination letter and EIN", why: "To show your tax status on receipts", format: "A copy of the letter and your EIN", who: "Treasurer" },
  { area: "Legal and tax", item: "Legal name, address and registration", why: "To print on receipts and statements", format: "Your registered name, address and state registration", who: "Secretary" },
  { area: "Legal and tax", item: "Bylaws and officers", why: "To set up governance and approvals", format: "Bylaws and the list of officers and board members", who: "Secretary" },
  { area: "Legal and tax", item: "Tax receipt wording", why: "Your accountant decides what a receipt must say", format: "Wording approved by your accountant", who: "Treasurer and accountant" },
  { area: "Legal and tax", item: "Privacy policy and terms of use", why: "To show members how their data is used", format: "Your documents, or we start from a template", who: "Board or administrator" },
  { area: "Legal and tax", item: "Refund and gift-acceptance policy", why: "To handle refunds and special gifts consistently", format: "Your written policy", who: "Treasurer" },
  { area: "Look and feel", item: "Logo and colors", why: "To brand your community", format: "Logo as SVG or PNG, brand colors", who: "Communications lead" },
  { area: "Look and feel", item: "Welcome message and photos", why: "To greet new members", format: "A short message and a few photos", who: "Communications lead" },
  { area: "Look and feel", item: "Address, hours and contact details", why: "To show members how to reach you", format: "Address, phone, email and opening hours", who: "Administrator" },
];

function cell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/** The checklist as a CSV: a byte-order mark so Excel reads the accents, every field quoted, a blank "Ready?" column. */
export function checklistCsv(rows: readonly ChecklistRow[] = CHECKLIST): string {
  const header = ["Area", "What to prepare", "Why we need it", "Format", "Who usually has it", "Ready?"];
  const lines = [header, ...rows.map((r) => [r.area, r.item, r.why, r.format, r.who, ""])];
  return "﻿" + lines.map((l) => l.map(cell).join(",")).join("\r\n") + "\r\n";
}
