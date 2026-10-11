// The things on the Platform console that change something. On this console every change is the Weaver team's own act, so each is a
// command of level "only you": registered so that Niva, the ⌘K palette and the activity record all know about it, but with no
// `execute`, so asking for one never does anything. The answer is a sentence and the exact screen. The existing screens keep their
// own safeguards: a preview before a change of kind, a reason that goes in the audit log, a fresh security code, and two different
// people for a go-live. Nothing here reads or writes.

import { defineCommand } from "../../define";
import { object, type Infer } from "../../schema";

const none = object({});
type None = Infer<typeof none>;

function onlyYou(spec: { key: string; title: string; description: string; label: string; href: string; covers: readonly string[] }) {
  return defineCommand<None, never>({
    key: spec.key,
    title: spec.title,
    description: `${spec.description} Only the Weaver team can do this, and only on the Platform screen: Niva cannot do it and never asks for it in the chat. It points the person to the place and waits.`,
    level: "only_you",
    permission: "dashboard",
    platformOnly: true,
    input: none,
    pointTo: { label: spec.label, href: spec.href },
    covers: spec.covers,
  });
}

export const changeKind = onlyYou({
  key: "platform.change_kind",
  title: "Change a community's kind of organization",
  description:
    "Change what kind of organization a community is. Modules the new kind does not have are hidden at once (their records stay), and the owner is emailed. The screen shows a preview first, asks why, and asks for a fresh security code. " +
    "platform.preview_kind_change shows the preview.",
  label: "Open Platform, open the community and use Kind of organization: read the preview, say why and enter your security code",
  href: "/platform",
  covers: ["src/app/(app)/platform/centers/[id]/actions.ts#previewKindChangeAction", "src/app/(app)/platform/centers/[id]/actions.ts#changeKindAction"],
});

export const decideAccessRequest = onlyYou({
  key: "platform.decide_access_request",
  title: "Decide a request for access",
  description: "Approve, decline or ask for more information on an organization's request to use Weaver. The decision emails the organization.",
  label: "Open Platform › Requests and use Approve, Decline or Ask for more",
  href: "/platform/requests",
  covers: ["src/app/(app)/platform/onboarding-actions.ts#decideRequestAction"],
});

export const decideGoLive = onlyYou({
  key: "platform.decide_go_live",
  title: "Approve or send back a go-live request",
  description: "Give the first or second approval for a sandbox to go live, or send the request back with a note. Two different people on the team must approve, and the go-live checks are shown first.",
  label: "Open Platform › Go-live approvals and use Review",
  href: "/platform/go-live",
  covers: ["src/app/(app)/platform/onboarding-actions.ts#decideGoliveAction"],
});

export const decideVerification = onlyYou({
  key: "platform.decide_verification",
  title: "Verify or send back a community's nonprofit papers",
  description: "Mark a community's nonprofit papers as verified, or send them back with a note, after looking at the documents it sent.",
  label: "Open Platform › Verification and use Review",
  href: "/platform/verification",
  covers: ["src/app/(app)/platform/verification/actions.ts#decideVerificationAction"],
});

export const setLimitsAndAddresses = onlyYou({
  key: "platform.set_limits_and_addresses",
  title: "Change a community's limits or portal addresses",
  description: "Change a plan limit of a community (such as how many households it may have) or add or remove one of its portal addresses. A reason is required and goes in the audit log.",
  label: "Open Platform, open the community and use Limits and Portal addresses",
  href: "/platform",
  covers: ["src/app/(app)/platform/centers/[id]/actions.ts#setEntitlementAction", "src/app/(app)/platform/centers/[id]/actions.ts#addDomainAction", "src/app/(app)/platform/centers/[id]/actions.ts#removeDomainAction"],
});

export const setCommunitySwitches = onlyYou({
  key: "platform.set_community_switches",
  title: "Switch recording or Niva's actions on or off for a community",
  description:
    "Switch on or off the recording of how a community uses the portal (only after its own administrator has agreed), or choose which actions Niva may prepare for it. A reason is required and goes in the audit log.",
  label: "Open Platform, open the community and use How this community uses Weaver or Niva for admins",
  href: "/platform",
  covers: ["src/app/(app)/platform/centers/[id]/actions.ts#setActivityRecordingAction", "src/app/(app)/platform/centers/[id]/actions.ts#saveAssistantAction"],
});

export const pauseWaysToPay = onlyYou({
  key: "platform.pause_ways_to_pay",
  title: "Pause or restart a way to pay",
  description: "Pause a way to pay for one community or for all of them, or lift a pause. It is the only power the team has over payments, and it stops new payments only.",
  label: "Open Platform › Payments and use Pause or Lift",
  href: "/platform/payments",
  covers: ["src/app/(app)/platform/payments/actions.ts#suspendPluginAction", "src/app/(app)/platform/payments/actions.ts#liftPauseAction"],
});

export const createSandbox = onlyYou({
  key: "platform.create_sandbox",
  title: "Create a sandbox for an organization",
  description: "Create a new sandbox community for an organization that has been approved.",
  label: "Open Platform › New sandbox",
  href: "/platform/new-sandbox",
  covers: ["src/app/(app)/platform/new-sandbox/actions.ts#createSandboxAction", "src/app/(app)/platform/actions.ts#saveWizardStepAction"],
});

export const manageSandboxCodes = onlyYou({
  key: "platform.manage_sandbox_codes",
  title: "Issue or cancel a sandbox code",
  description: "Issue a new sign-up code for a sandbox, or cancel one that was issued.",
  label: "Open Platform › Sandbox codes",
  href: "/platform/codes",
  covers: ["src/app/(app)/platform/onboarding-actions.ts#reissueCodeAction", "src/app/(app)/platform/onboarding-actions.ts#revokeCodeAction"],
});

export const endSupportAccess = onlyYou({
  key: "platform.end_support_access",
  title: "End a support access window early",
  description: "End a time-limited support access that a community's owner opened for the team, before it runs out.",
  label: "Open Platform › Support access and use End",
  href: "/platform/support-access",
  covers: ["src/app/(app)/platform/onboarding-actions.ts#endSupportGrantAction"],
});

export const publishAgreement = onlyYou({
  key: "platform.publish_agreement",
  title: "Edit or publish a platform agreement",
  description: "Edit the draft of a platform agreement (the terms or the data agreement) or publish it so every community is asked to accept it.",
  label: "Open Platform › Agreements",
  href: "/platform/agreements",
  covers: ["src/app/(app)/platform/agreements/actions.ts#savePlatformDraftAction", "src/app/(app)/platform/agreements/actions.ts#publishPlatformDraftAction"],
});

export const runPlatformSetup = onlyYou({
  key: "platform.run_platform_setup",
  title: "Set up the platform's own services",
  description:
    "Walk through the platform's own setup: its email, text and sign-in services, their keys and their tests. Secrets are typed into a secure box and are never shown to anyone, including Niva.",
  label: "Open Platform › Platform setup",
  href: "/platform/setup",
  covers: [
    "src/app/(app)/platform/setup/actions.ts#saveFieldAction",
    "src/app/(app)/platform/setup/actions.ts#generateFieldAction",
    "src/app/(app)/platform/setup/actions.ts#testStepAction",
    "src/app/(app)/platform/setup/actions.ts#testSignInHookAction",
    "src/app/(app)/platform/setup/actions.ts#completeStepAction",
    "src/app/(app)/platform/setup/actions.ts#parkStepAction",
    "src/app/(app)/platform/setup/actions.ts#reopenStepAction",
    "src/app/(app)/platform/setup/actions.ts#setupLaterAction",
  ],
});

export const PLATFORM_ONLY_YOU = [
  changeKind,
  decideAccessRequest,
  decideGoLive,
  decideVerification,
  setLimitsAndAddresses,
  setCommunitySwitches,
  pauseWaysToPay,
  createSandbox,
  manageSandboxCodes,
  endSupportAccess,
  publishAgreement,
  runPlatformSetup,
] as const;
