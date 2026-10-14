// Niva for admins during onboarding (0755): AI used in onboarding stays core (docs/MARKETPLACE_PACKS.md section 2), so while
// a community is onboarding (app.centers.status, the database's own state) and iWeaver is off, the chat still answers on the
// onboarding pages, with these commands only. Every one of them reads or points the person to where they act themselves:
// nothing here changes a record, so no confirmation card can come from an onboarding chat.
//
// The same monthly limit counts these messages (app.assistant_usage_check with 'onboarding', which the database allows without
// iWeaver only while the community is onboarding), and every command still checks the person's own permission.

import { CommandRegistry } from "@/lib/commands/registry";

/** The setup checks and the "only you" pointers of Setup: what someone bringing their community onto Weaver asks about. */
export const ONBOARDING_COMMAND_KEYS: readonly string[] = [
  "settings.setup_status",
  "settings.integrations_health",
  "settings.modules_state",
  "settings.enter_secret",
  "settings.accept_agreements",
  "settings.connect_quickbooks",
  "settings.connect_payments",
  "settings.change_domain_records",
  "settings.confirm_as_owner",
  "settings.send_nonprofit_proof",
  "settings.go_live",
];

/** A registry with the onboarding commands of `source` only (a key that is not registered there is left out). */
export function onboardingRegistry(source: CommandRegistry): CommandRegistry {
  const out = new CommandRegistry();
  for (const key of ONBOARDING_COMMAND_KEYS) {
    const command = source.get(key);
    if (command) out.register(command);
  }
  return out;
}
