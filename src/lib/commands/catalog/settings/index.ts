// The Settings and Setup commands (B90 phase 4): Niva as the setup concierge and the roles helper.
//
//   read       what is left before go-live; who holds a role; who can see or do something; whether the connected services work;
//              which modules are on
//   draft      prepare a role for someone (never gives it)
//   only you   secrets, agreements, sign-ins to other services, DNS, the owner's confirmations, going live, acting as the second
//              approver: each says where the person does it, and nothing else (no execute)
//
//   confirm    give a role, take a role away, switch a module on or off: roles, permissions and what members see are the owner's, so each
//              of these is OFF for Niva until the community's owner ticks it (Platform › Niva for admins). The Roles and Modules
//              screens call the same `execute` through runScreenCommand.

import type { AnyCommand } from "../../types";

import { draftRoleGrant } from "./draft-role-grant";
import { grantRole, revokeRole } from "./grant-role";
import { integrationsHealth } from "./integrations-health";
import { modulesState } from "./modules-state";
import { ONLY_YOU_COMMANDS } from "./only-you";
import { roleHolders, whoCanAccess } from "./role-holders";
import { setModule } from "./set-module";
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
  // confirm (off by default)
  grantRole,
  revokeRole,
  setModule,
  // only you
  ...ONLY_YOU_COMMANDS,
];
