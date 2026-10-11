// The things in Settings and Setup that only the person can do (docs/ADMIN_REDESIGN.md, level 4 "Only you"): secrets, agreements,
// sign-ins to other services, DNS, the owner's own confirmations, going live and acting as the second approver. Each is a command so
// that Niva, the ⌘K palette and the activity record all know about it, but none of them has an `execute`: asking for one never does
// anything. The answer is a sentence and the exact screen. Nothing here reads or writes.

import type { AccessKey } from "@/lib/permissions";

import { defineCommand } from "../../define";
import { object, type Infer } from "../../schema";

const none = object({});
type None = Infer<typeof none>;

function onlyYou(spec: { key: string; title: string; description: string; permission: AccessKey; label: string; href: string; covers?: readonly string[] }) {
  return defineCommand<None, never>({
    key: spec.key,
    title: spec.title,
    description: `${spec.description} Niva cannot do this and never asks for it in the chat: it points the person to the place and waits.`,
    level: "only_you",
    permission: spec.permission,
    input: none,
    pointTo: { label: spec.label, href: spec.href },
    ...(spec.covers ? { covers: spec.covers } : {}),
  });
}

export const enterSecret = onlyYou({
  key: "settings.enter_secret",
  title: "Enter or change a secret, key or token",
  description: "Enter, replace or rotate a secret for a connected service (a Twilio token, an email provider key, a payment key). Secrets are typed into a secure box and are never shown to anyone, including Niva.",
  permission: "integrations",
  label: "Open Settings › Integrations, choose the service and type the value in its secure box",
  href: "/settings/integrations",
  covers: ["src/app/(app)/settings/integrations/actions.ts#setSecretAction", "src/app/(app)/settings/integrations/actions.ts#revokeSecretAction"],
});

export const acceptAgreements = onlyYou({
  key: "settings.accept_agreements",
  title: "Accept the community's agreements",
  description: "Accept the agreements the community signs with Weaver (the terms of service and the data agreement). The owner reads each one and accepts it; it is recorded under their name.",
  permission: "centerSettings",
  label: "Open Settings › Agreements. The owner reads each agreement and accepts it",
  href: "/settings/agreements",
  covers: ["src/app/(app)/settings/agreements/actions.ts#acceptAgreementAction"],
});

export const connectQuickbooks = onlyYou({
  key: "settings.connect_quickbooks",
  title: "Sign in to QuickBooks to connect it",
  description: "Connect QuickBooks Online. The person signs in to QuickBooks themselves and allows Weaver to connect; Weaver never sees the QuickBooks password.",
  permission: "qboConnection",
  label: "Open Accounting › QuickBooks setup and press Connect. You sign in to QuickBooks yourself",
  href: "/accounting/qbo/setup",
  covers: ["src/app/(app)/accounting/qbo/setup/actions.ts#startQboConnectAction"],
});

export const connectPayments = onlyYou({
  key: "settings.connect_payments",
  title: "Sign in to connect a payment account",
  description: "Connect Stripe or PayPal so the community can take payments online, and run the $1 test charge. The person signs in to the payment account themselves.",
  permission: "paymentSettings",
  label: "Open Settings › Payments, choose Stripe or PayPal and sign in to your own account",
  href: "/settings/payments",
  covers: [
    "src/app/(app)/settings/payments/actions.ts#startConnectAction",
    "src/app/(app)/settings/payments/actions.ts#sendPaypalCodeAction",
    "src/app/(app)/settings/payments/actions.ts#confirmPaypalCodeAction",
  ],
});

export const changeDomainRecords = onlyYou({
  key: "settings.change_domain_records",
  title: "Change the DNS records of the email domain",
  description: "Add or change the DNS records of the community's email sending domain, so mail from the community is trusted. The records are added where the domain is registered, by whoever controls the domain.",
  permission: "messagingManage",
  label: "Open Settings › Email: it lists the exact records to add where the domain is registered. Only whoever controls the domain can add them",
  href: "/settings/email",
});

export const confirmAsOwner = onlyYou({
  key: "settings.confirm_as_owner",
  title: "Confirm as the owner: staff trained, health check, pilot",
  description: "Give the owner's own confirmations that staff are trained, that the sandbox health check is green and that the pilot is done. Each is recorded with the owner's name and nobody can give it for them.",
  permission: "setup",
  label: "Open Setup › Go-live. The owner presses Confirm for each item",
  href: "/setup/go-live",
  covers: ["src/app/(app)/setup/go-live/actions.ts#attestAction"],
});

export const sendNonprofitProof = onlyYou({
  key: "settings.send_nonprofit_proof",
  title: "Send the non-profit proof for Weaver's review",
  description: "Send the community's legal identity and non-profit documents to Weaver for review. The owner attests that they are true.",
  permission: "setup",
  label: "Open Setup › Legal identity, check the details and documents, then press Send for review",
  href: "/setup/organization",
  covers: ["src/app/(app)/setup/actions.ts#submitVerificationAction"],
});

export const goLive = onlyYou({
  key: "settings.go_live",
  title: "Ask to go live",
  description: "Ask Weaver to take the community live, and switch the sandbox to production once two Weaver administrators approve. Going live is the owner's decision.",
  permission: "setup",
  label: "Open Setup › Go-live. The owner requests go-live there once the checks pass",
  href: "/setup/go-live",
  covers: ["src/app/(app)/setup/go-live/actions.ts#requestGoliveAction", "src/app/(app)/setup/go-live/actions.ts#promoteAction"],
});

export const secondApproval = onlyYou({
  key: "settings.second_approval",
  title: "Act as the second person for a role",
  description: "Approve a role that someone else asked for. Treasurer, administrator, finance volunteer, executive committee and privacy officer roles start only after a DIFFERENT administrator approves them, so the person who asked can never approve their own.",
  permission: "roles",
  label: "Open Settings › Roles & entitlements, Waiting for approval, and press Approve. It has to be a different administrator from the one who asked",
  href: "/settings/roles?show=pending",
  covers: ["src/app/(app)/settings/roles/actions.ts#approveGrantAction"],
});

export const ONLY_YOU_COMMANDS = [enterSecret, acceptAgreements, connectQuickbooks, connectPayments, changeDomainRecords, confirmAsOwner, sendNonprofitProof, goLive, secondApproval] as const;
