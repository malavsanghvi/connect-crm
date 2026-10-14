// The first tour (the prototype): the Treasurer matches a bank line to the right household and pledge.
// Giving › Payments › Bank, in the order a treasurer lives it. The tour is read-only: it lights the real screen and says what each part
// is and what the confirm button will do. It never presses it. Words are written for every community: no tradition's words, no one
// community's name; the names of the areas come from the screen itself, which already uses the community's own labels.
//
// Every `target` is a `data-spotlight` attribute in the source (tests/spotlight-tours.test.ts checks that none is missing).

import type { TourDef } from "../types";

const BANK_PAGE = "/giving/payments/bank";

export const TREASURER_BANK_MATCH: TourDef = {
  id: "treasurer-bank-match",
  title: "Match a bank line to the right household",
  summary: "Follow one bank line from your Home to the confirm button and into QuickBooks.",
  minutes: 1,
  persona: ["treasurer"],
  // The screens of the tour: Giving › Bank (and Accounting › QuickBooks sync, an optional step) must open for this person.
  requires: { access: ["bank"], modules: ["giving", "giving_bank"] },
  steps: [
    {
      id: "home-task",
      target: "home-bank-task",
      href: "/",
      title: "Your bank lines wait here",
      body: "Home lists the work that is yours. This row counts the bank lines nobody has matched to a household yet; open it to start.",
      placement: "bottom",
      missing:
        "Nothing is waiting on your Home right now, which means every bank line has been matched. The next steps still show you where the work happens.",
    },
    {
      id: "money-area",
      target: "nav-giving",
      // No page of its own: the navigation is on every page, so Back from the Bank tab does not send the person home first.
      title: "The money area",
      body: "Pledges, payments, deposits and the bank statement all live in this area of the navigation. Bank matching is one of its tabs.",
      placement: "right",
      // On a phone the navigation is folded into a menu, so there is nothing to light: the step is left out.
      optional: true,
    },
    {
      id: "bank-views",
      target: "bank-views",
      href: BANK_PAGE,
      title: "The Bank tab",
      body: "Import the bank's statement here, then match each line: gift lines go to a household, while deposits, card payouts and money out have their own views.",
      placement: "bottom",
    },
    {
      id: "bank-line",
      target: "bank-line",
      href: BANK_PAGE,
      title: "One line from the bank",
      body: "This is what the bank reported: the amount, the date, its own description, how the money arrived (a Zelle payment, an ACH credit, a wire) and the payer's name.",
      placement: "auto",
      missing: "There is no bank line to match on this screen right now. When one arrives from an import, it is shown here with what the bank reported.",
    },
    {
      id: "household-card",
      target: "bank-household",
      href: BANK_PAGE,
      title: "Who it most likely came from",
      body: "Weaver suggests a household and shows its card: IDs, members, address and last gift. Check the card, not only the name; a name alone is never enough.",
      placement: "auto",
      missing:
        "No line has a clear suggestion right now. When one does, the household card appears here beside the line. A line with several possible households asks you to review the cards first.",
    },
    {
      id: "confirm",
      target: "bank-confirm",
      href: BANK_PAGE,
      title: "What Confirm match does",
      body: "It records the payment, applies it to the earliest open pledge, queues the QuickBooks entry once and remembers the payer's name for next time. The tour will not press it.",
      placement: "auto",
      missing:
        "The lines on this screen have no single clear suggestion, so there is no Confirm match button to show. When a line does, this is the button that records it.",
    },
    {
      id: "where-it-lands",
      target: "qbo-sync-status",
      href: "/accounting/qbo",
      title: "Where it lands",
      body: "In QuickBooks sync, a confirmed match shows as one pending posting, then as posted. Anything that fails waits there for a person, never silently.",
      placement: "bottom",
      // A treasurer whose community does not use the accounting screens simply does not see this stop.
      optional: true,
    },
    {
      id: "try-it",
      target: "bank-confirm",
      href: BANK_PAGE,
      title: "Try it yourself",
      body: "That is the whole path: the line, the household card, then Confirm match. The button is real, so press it only when you are sure of the household.",
      placement: "auto",
      interactive: true,
      missing: "When a bank line has a clear suggestion, its Confirm match button is lit here for you to press.",
    },
  ],
};
