import "server-only";

import { platformEnv } from "@/lib/platform-setup/server-config";

// Can this Weaver server send email right now? CatchTheMatch's messages (the ask for an employer, the claim message) go through the
// existing messaging queue; the background service sends them with the email provider's key. When the key is missing nothing can leave,
// so the portal says so BEFORE queueing anything: a message queued without a provider would only fail later, in a place nobody is looking
// (backlog B116). Pure reads of the platform setup (saved in Platform › Platform setup, else the server's environment): never a key's value.

export type SendReady = { ok: true } | { ok: false; error: string };

const EMAIL_HELP = "Ask the Weaver team to finish the email setup (Platform › Platform setup, step Email), then try again.";

export function emailReadinessFrom(env: Record<string, string | undefined>, options: { memberAppLink: boolean }): SendReady {
  const value = (name: string) => (env[name] ?? "").trim();
  const provider = value("MESSAGING_EMAIL_PROVIDER") === "postmark" ? "postmark" : "resend";
  const missing: string[] = [];
  if (provider === "resend" && !value("RESEND_API_KEY")) missing.push("the Resend API key");
  if (provider === "postmark" && !value("POSTMARK_SERVER_TOKEN")) missing.push("the Postmark server token");
  if (options.memberAppLink && !value("MEMBER_APP_URL") && !value("NEXT_PUBLIC_MEMBER_APP_URL")) missing.push("the member app's address (MEMBER_APP_URL)");
  if (missing.length === 0) return { ok: true };
  return {
    ok: false,
    error: `Email sending is not set up on the Weaver server yet (it still needs ${missing.join(" and ")}), so nothing was sent or queued. ${EMAIL_HELP}`,
  };
}

/** The server's email readiness, from the platform setup and the environment. */
export async function emailReadiness(options: { memberAppLink: boolean }): Promise<SendReady> {
  return emailReadinessFrom(await platformEnv(), options);
}
