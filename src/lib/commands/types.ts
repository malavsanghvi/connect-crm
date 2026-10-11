// The command layer: ONE typed command per action (docs/ADMIN_REDESIGN.md "To build first", MASTER_PLAN "one command layer").
// The screens, the ⌘K palette, the Niva chat and the activity recorder all call the same commands. A command says what it is
// (key, title, a description written for a model), who may use it (an ACCESS key from src/lib/permissions.ts and an optional
// module), what it takes (an input schema), what it will do (preview) and how to do it (execute).
//
// Four levels (ADMIN_REDESIGN "What Niva may do"):
//   read       look, search, explain. Runs at once; returns only what the person's role may see.
//   draft      prepare, never apply. Runs at once; nothing changes.
//   confirm    money, messages to members, roles and permissions, merges, anything that deletes. Never runs from the call itself:
//              it records a proposal, the person confirms it in the database, then it runs.
//   only_you   secrets, agreements, sign-ins, going live. A command of this level never runs; it tells the person where to go.

import type { ActionResult } from "@/lib/errors";
import type { ModuleKey } from "@/lib/modules";
import type { AccessKey } from "@/lib/permissions";
import type { CrmSession } from "@/lib/session";

import type { MinorNameSource } from "./child-filter";
import type { ProposalStore } from "./proposals";
import type { CommandRegistry } from "./registry";
import type { ObjectSchema } from "./schema";
import type { KindText } from "./text";

export type CommandLevel = "read" | "draft" | "confirm" | "only_you";

/** Who is calling: a screen's own button, the ⌘K palette, or the Niva chat (a model chose the command and filled its input). */
export type CommandVia = "screen" | "palette" | "assistant";

/** What a command works with. Built by createCommandContext (context.ts) in the app; tests build their own. */
export type CommandContext = {
  /** The signed-in person's session. For `via: "assistant"` its db writes audit rows as client_app "assistant". */
  session: CrmSession;
  via: CommandVia;
  proposals: ProposalStore;
  /** Defaults to the shared registry (registry.ts). */
  registry?: CommandRegistry;
  /** Names of people under 18, used as a last check on what a model would see (child-filter.ts). Required for `via: "assistant"`. */
  minors?: MinorNameSource;
  now?: () => Date;
};

// ---------------------------------------------------------------------------
// What a person sees before confirming
// ---------------------------------------------------------------------------
export type PreviewLine = {
  label: string;
  /** A single value ("Applies to 3 households"). */
  value?: string;
  /** A change: what it is now, and what it will be. */
  before?: string | null;
  after?: string | null;
};

/** A household as the confirmation card shows it: never a name alone. Adults only when a model will see it (child-filter.ts). */
export type HouseholdCard = {
  household_id: string;
  household_name: string | null;
  household_number: string | null;
  org_household_id: string | null;
  adults: string[];
  primary_adult: string | null;
  zone: string | null;
  city: string | null;
  last_gift_on: string | null;
  open_pledge_cents: number | null;
  /** open_pledge_cents in the community's currency, ready to show. */
  open_pledge: string | null;
};

export type CommandPreview = {
  /** One sentence: what will happen. "Change the venue of Diwali Dinner." */
  summary: string;
  lines: PreviewLine[];
  /** Household cards the action touches (money and people actions show them, never a name alone). */
  households?: HouseholdCard[];
  /** Things to know before pressing the button. */
  warnings?: string[];
};

// ---------------------------------------------------------------------------
// What a command returns
// ---------------------------------------------------------------------------
export type CommandSuccess<O> = { ok: true; data: O; message?: string };
export type CommandFailure = { ok: false; error: string; stepUp?: boolean };
export type CommandExecResult<O> = CommandSuccess<O> | CommandFailure;

/** Throw this from a command for a problem the person can fix; the sentence is shown as it is. */
export class CommandError extends Error {
  constructor(
    message: string,
    readonly code: CommandErrorCode = "invalid",
  ) {
    super(message);
    this.name = "CommandError";
  }
}

/** A database step failed. `doing` says which step, in plain words ("read the pledges"); the detail is logged and explained by failure(). */
export class CommandDbError extends Error {
  constructor(
    readonly dbError: unknown,
    readonly doing: string,
  ) {
    super(`${doing} failed`);
    this.name = "CommandDbError";
  }
}

export type CommandErrorCode =
  | "unknown_command"
  | "no_access"
  | "module_off"
  | "switched_off"
  | "screen_only"
  | "invalid"
  | "only_you"
  | "unsafe_result"
  | "proposal_failed"
  | "wrong_community"
  | "needs_step_up"
  | "failed";

export type Command<I = never, O = unknown> = {
  /** `area.verb`, lower case: "people.search". Also the audit label and the center setting `assistant.tools.<key>`. */
  key: string;
  /** Short and plain: "Search people and households". Shown on cards and in the palette. */
  title: string;
  /**
   * Written for a model: what it does, when to use it, what it returns, what it never does. A function when it names the community's
   * own words (its school, its currency): it is given the community's kind (see text.ts).
   */
  description: KindText;
  level: CommandLevel;
  /** The ACCESS key (src/lib/permissions.ts) whose holders may use it. RLS in the database is the real check. */
  permission: AccessKey;
  /** Hidden when this module is switched off for the community. */
  module?: ModuleKey;
  /** Only the Weaver team (platform admins) may use it. It is never offered to anyone else, whatever their roles or permissions are. */
  platformOnly?: boolean;
  input: ObjectSchema<I>;
  /** What will happen, before anything does. Runs when a confirm command is proposed (and a draft may share it). */
  preview?: (ctx: CommandContext, input: I) => Promise<CommandPreview>;
  /** Do it. Return a result, or throw CommandError for a problem to show; any other error is logged and explained. */
  execute?: (ctx: CommandContext, input: I) => Promise<CommandExecResult<O>>;
  /** The sentence on the confirm button's card. */
  confirmText?: string | ((input: I, preview: CommandPreview) => string);
  /**
   * Whether Niva may use it in a community that has not said. Read and draft default to on; confirm defaults to OFF until the
   * owner approves it (switch: the community setting `assistant.tools.<key>`, see enabled.ts). Applies to the assistant only: a
   * screen or the palette is the person's own hands, with the permission they already have.
   */
  enabledByDefault?: boolean;
  /** For level only_you: where the person does it themselves. */
  pointTo?: { label: string; href: string };
  /**
   * Only the person's own screen may run it. The registry never offers it to Niva or to the palette's AI, and the community cannot
   * switch it on (there is no switch): used for work that must not go through a model, like anything about a learner (decision D2).
   * A screen reaches it through runScreenCommand, as for any command.
   */
  screenOnly?: boolean;
  /** Server Actions this command replaces, as "src/app/(app)/events/actions.ts#saveEvent" (scripts/commands-coverage.mjs reads this). */
  covers?: readonly string[];
};

/** A command with its input type erased, as the registry holds it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyCommand = Command<any, any>;

// ---------------------------------------------------------------------------
// What runCommand returns
// ---------------------------------------------------------------------------
export type CommandNeedsConfirmation = {
  ok: true;
  needsConfirmation: true;
  proposalId: string;
  inputHash: string;
  preview: CommandPreview;
  confirmText: string;
  expiresAt: string | null;
};

export type CommandRunResult<O = unknown> =
  | { ok: true; data: O; message?: string; needsConfirmation?: undefined }
  | CommandNeedsConfirmation
  | {
      ok: false;
      error: string;
      code: CommandErrorCode;
      /** The database asked for a fresh 2FA check: open the security code window, then confirm again with `retry`. */
      needsStepUp?: true;
      /** Same meaning as ActionResult.stepUp, so existing UI can read it. */
      stepUp?: true;
      /** After a step-up: a fresh proposal for the same action (the first one was used up). */
      retry?: { proposalId: string; inputHash: string; expiresAt: string | null };
      /** For an only_you command: where the person does it. */
      onlyYou?: { label: string; href: string };
    };

/** A command result as an ActionResult, for a Server Action that calls a command. */
export function toActionResult<O>(result: CommandRunResult<O>): ActionResult<O> {
  if (!result.ok) return { ok: false, error: result.error, stepUp: result.stepUp };
  if (result.needsConfirmation) return { ok: false, error: "This action needs to be confirmed first." };
  return { ok: true, data: result.data, message: result.message };
}

// ---------------------------------------------------------------------------
// The record of a call (the activity recorder plugs in at hooks.ts)
// ---------------------------------------------------------------------------
export type CommandEvent = {
  key: string;
  level: CommandLevel | null;
  via: CommandVia;
  /** What happened: ran, was refused, was proposed for confirmation, was confirmed, failed. */
  outcome: "ok" | "proposed" | "confirmed" | "rejected" | "denied" | "invalid" | "failed" | "needs_step_up";
  code?: CommandErrorCode;
  durationMs: number;
  at: string;
  centerId: string;
  userId: string;
  personId: string | null;
  /** The person's role keys when they acted. */
  roles: string[];
  requestId: string;
  proposalId?: string;
  /** The names of the values given, never the values. */
  inputKeys: string[];
  /** The plain-English reason, when it did not work. */
  error?: string;
};
