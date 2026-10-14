// Every word the Spotlight engine itself says (buttons, notes, announcements), in one place, so another language can replace this
// object without touching the engine. The words of a tour's steps live in the tour (src/lib/spotlight/tours/*).

export const SPOTLIGHT_TEXT = {
  /** "Step 2 of 8" */
  stepOf: (n: number, total: number) => `Step ${n} of ${total}`,
  /** The live region on arriving at a step. */
  announceStep: (n: number, total: number, title: string) => `Step ${n} of ${total}: ${title}`,
  announceSkipped: "Tour skipped",
  announceFinished: "Tour finished",
  announceOff: "Tours are turned off. You can turn them back on from the Tour menu.",
  announceOn: "Tours are turned on.",
  next: "Next",
  back: "Back",
  skip: "Skip tour",
  finish: "Finish",
  close: "Close",
  closeTour: "Close tour",
  tryAgain: "Try again",
  waiting: "Finding this part of the screen…",
  /** The card when a step's target is not on the screen and the step has no words of its own. */
  missing:
    "We could not find this part of the screen. It may still be loading, or it may not be available to you here. You can try again, go on to the next step, or skip the tour.",

  // The invitation on Home
  inviteKicker: "New here?",
  inviteTitle: "Take the 1-minute tour",
  inviteMinutes: (minutes: number) => (minutes <= 1 ? "1-minute tour" : `${minutes}-minute tour`),
  inviteStart: "Take the tour",
  inviteNotNow: "Not now",
  inviteNever: "Don't show tours again",
  inviteReadOnly: "Nothing changes while you look. You can skip at any step.",
  notRemembered: "This browser would not let us remember your choice, so the invitation may come back. Tours can be turned off from the Tour menu.",

  // The Tour item of the account menu
  menuItem: "Tour",
  menuTitle: "Tours for your role",
  menuReplay: "Take the tour",
  menuTurnOff: "Don't show tours again",
  menuTurnOn: "Turn tours back on",
  menuOffNote: "Tours are turned off for you here. No invitations are shown.",
  menuSeenNote: "You have taken this tour before.",

  // The demo banner
  bannerLink: "Take the tour",
} as const;
