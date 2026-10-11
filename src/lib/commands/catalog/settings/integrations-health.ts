import { buildHealthView, type HealthView } from "@/lib/settings-help/health-view";
import { readNotificationSettings } from "@/lib/settings-rules";

import { defineCommand } from "../../define";
import { object, type Infer } from "../../schema";
import { stripSecrets } from "../../secrets";

import { must } from "../db";

const input = object({});

function phoneSignInOn(rules: unknown): boolean {
  const security = rules && typeof rules === "object" ? (rules as Record<string, unknown>).security : undefined;
  const value = security && typeof security === "object" ? (security as Record<string, unknown>).phone_sign_in : undefined;
  return value !== false;
}

/** Whether QuickBooks, payments, texting, email and the other connected services work, in plain words, and where to fix each. */
export const integrationsHealth = defineCommand<Infer<typeof input>, HealthView>({
  key: "settings.integrations_health",
  title: "Check the connected services",
  description:
    "Say whether the connected services work: QuickBooks, payments (Stripe or PayPal), texting, the email sending domain, WhatsApp, push notifications and the background service. " +
    "For each it returns a status in plain words, why it is not working and the screen to fix it. Also returns the texting registration with the carriers and the reasons texts may not be going out " +
    "(not registered, rejected, a provider problem, quiet hours, people who replied STOP) and the state of each email sending domain. " +
    "It reads status only: it never returns a key, a token or a secret, and it changes nothing. Entering a key or signing in to a service is something only the person can do (settings.enter_secret and the other 'only you' actions say where).",
  level: "read",
  permission: "integrations",
  input,
  async execute(ctx) {
    const { db, center } = ctx.session;
    const [conns, ready, domains, regs] = await Promise.all([
      db.from("integration_connections").select("provider, status, display_name, settings, connected_at, token_expires_at, last_error").eq("center_id", center.id),
      db.rpc("readiness", { p_center: center.id }),
      db.from("email_domains").select("domain, status, last_error").eq("center_id", center.id).order("created_at"),
      db.from("texting_registrations").select("kind, status, detail").eq("center_id", center.id),
    ]);
    const connections = must(conns, "read the connected services") ?? [];
    const quiet = readNotificationSettings(center.rules);
    const view = buildHealthView({
      connections,
      readiness: must(ready, "read the go-live checks") ?? [],
      emailDomains: must(domains, "read the email domains") ?? [],
      texting: {
        registrations: must(regs, "read the texting registration") ?? [],
        connection: connections.find((c) => c.provider === "twilio") ?? null,
        phoneSignIn: phoneSignInOn(center.rules),
        quietStartHour: quiet.quietStartHour,
        quietEndHour: quiet.quietEndHour,
      },
    });
    // A provider's own error text can carry a key or a token. It is cleaned here for every door, not only for Niva.
    return { ok: true, data: stripSecrets(view).value, message: view.summary };
  },
});
