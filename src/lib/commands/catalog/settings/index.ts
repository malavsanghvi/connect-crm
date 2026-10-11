// The Settings and Setup commands (B90 phase 4): Niva as the setup concierge and the roles helper.
//
//   read       what is left before go-live; who holds a role; who can see or do something; whether the connected services work;
//              which modules are on
//   draft      prepare a role for someone (never gives it)
//   only you   secrets, agreements, sign-ins to other services, DNS, the owner's confirmations, going live, acting as the second
//              approver: each says where the person does it, and nothing else (no execute)
//
// Roles, permissions and the module switches are the owner's: the commands that CHANGE them are separate, confirm-level, and off for
// Niva until the community ticks them. This file lists what ships first.

import type { AnyCommand } from "../../types";

import { draftRoleGrant } from "./draft-role-grant";
import { integrationsHealth } from "./integrations-health";
import { modulesState } from "./modules-state";
import { ONLY_YOU_COMMANDS } from "./only-you";
import { roleHolders, whoCanAccess } from "./role-holders";
import { setupStatus } from "./setup-status";

/** In the order a person would meet them: look, prepare, then the things only they can do. */
export const SETTINGS_COMMANDS: readonly AnyCommand[] = [
  // read
  setupStatus,
  roleHolders,
  whoCanAccess,
  integrationsHealth,
  modulesState,
  // draft
  draftRoleGrant,
  // only you
  ...ONLY_YOU_COMMANDS,
];
