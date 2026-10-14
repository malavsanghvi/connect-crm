"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Modal } from "@/components/modal";
import { useStepUp } from "@/components/step-up";
import { useToast } from "@/components/toast";
import { buttonClass } from "@/components/ui";

import {
  createDemoCommunityAction,
  resetDemoCommunityAction,
  setDemoSigninAction,
  setupDemoSigninAction,
  type DemoSigninResult,
} from "./demo-signin-actions";

// The buttons of Platform › Setup › Demo sign-in. Each one writes its own description to the audit log as its reason; a failure is shown in the box that was open, so nothing is lost and nothing is claimed done that was not.

type Action = { label: string; title: string; explain: string; confirm: string; tone?: "primary" | "warn" | "bad"; run: (reason: string) => Promise<DemoSigninResult>; what: string; defaultReason: string };

function useRun() {
  const toast = useToast();
  const stepUp = useStepUp();
  const router = useRouter();
  return async function run(fn: () => Promise<DemoSigninResult>, what: string): Promise<DemoSigninResult> {
    let res: DemoSigninResult;
    try {
      res = stepUp ? await stepUp.run(fn, what) : await fn();
    } catch (err) {
      console.error(`[demo-signin] ${what} failed:`, err);
      res = { ok: false, error: `Could not ${what} — the server did not answer. Check the connection and try again. Nothing was changed.` };
    }
    if (res.ok) {
      toast?.show(res.message ?? "Done", "ok");
      router.refresh();
    } else {
      toast?.show(res.error, "bad");
    }
    return res;
  };
}

/**
 * One button of the card. No "Why?" box: the action's own description goes to the audit log as its reason. A plain confirmation (no typing)
 * is asked only for the actions that end something (switching off, new passwords, starting a community over).
 */
function ReasonButton({ action, kind = "ghost", disabled = false }: { action: Action; kind?: "ghost" | "primary" | "bad"; disabled?: boolean }) {
  const run = useRun();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const asksFirst = action.tone === "warn" || action.tone === "bad";

  async function go() {
    setWorking(true);
    setError(null);
    setOpen(false);
    const res = await run(() => action.run(action.defaultReason), action.what);
    setWorking(false);
    if (!res.ok && asksFirst) {
      setError(res.error);
      setOpen(true);
    }
  }

  return (
    <>
      <button
        type="button"
        className={buttonClass(kind, "xs")}
        disabled={working || disabled}
        onClick={() => {
          setError(null);
          if (asksFirst) setOpen(true);
          else void go();
        }}
      >
        {working ? "Working…" : action.label}
      </button>
      {asksFirst ? (
        <Modal open={open} kicker="Demo sign-in" title={action.title} confirmLabel={action.confirm} tone={action.tone} pending={working} error={error} onConfirm={() => void go()} onCancel={() => setOpen(false)}>
          <p className="text-[13px] text-muted">{action.explain}</p>
        </Modal>
      ) : null}
    </>
  );
}

export function DemoSigninControls({
  enabled,
  allReady,
  anyReady,
  kindsMissing,
  communities,
}: {
  enabled: boolean;
  allReady: boolean;
  anyReady: boolean;
  kindsMissing: ("faith" | "neutral")[];
  communities: { id: string; name: string }[];
}) {
  return (
    <div className="flex flex-col gap-3" data-testid="demo-signin-controls">
      <div className="flex flex-wrap gap-2">
        {kindsMissing.map((k) => (
          <ReasonButton
            key={k}
            action={{
              label: k === "faith" ? "Create the faith-based demo" : "Create the not faith-based demo",
              title: k === "faith" ? "Create the faith-based demo community" : "Create the not faith-based demo community",
              explain: "Makes a practice community of invented people, with one demo person for every role. It never contains real data and starts over every night.",
              confirm: "Create",
              what: "create the demo community",
              defaultReason: "Create the demo community",
              run: (reason) => createDemoCommunityAction(k, reason),
            }}
          />
        ))}
        <ReasonButton
          kind={allReady ? "ghost" : "primary"}
          action={{
            label: allReady ? "Check the sign-ins again" : "Set up the sign-ins",
            title: "Set up the demo sign-ins",
            explain:
              "Gives every demo person their own sign-in (an address on demo.weaverams.org nobody receives mail on) with a long random password kept in the vault, and links it to their person and role inside the demo community only. Sign-ins that already exist are left as they are.",
            confirm: "Set up",
            what: "set up the demo sign-ins",
            defaultReason: "Set up the demo sign-ins",
            run: (reason) => setupDemoSigninAction(reason, false),
          }}
          disabled={communities.length === 0}
        />
        {anyReady ? (
          <ReasonButton
            action={{
              label: "Replace the passwords",
              title: "Replace the demo passwords",
              explain: "Makes a new random password for every demo sign-in and ends every running demo. Do this if you think a password was seen.",
              confirm: "Replace",
              tone: "warn",
              what: "replace the demo passwords",
              defaultReason: "Replace the demo passwords",
              run: (reason) => setupDemoSigninAction(reason, true),
            }}
          />
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {enabled ? (
          <ReasonButton
            kind="bad"
            action={{
              label: "Turn the demo off",
              title: "Turn the demo off",
              explain: "Nobody can start a demo, and every demo running now ends at once (on its next click it sends the person back to the demo page).",
              confirm: "Turn off",
              tone: "bad",
              what: "turn the demo off",
              defaultReason: "",
              run: (reason) => setDemoSigninAction(false, reason),
            }}
          />
        ) : (
          <ReasonButton
            kind="primary"
            disabled={!anyReady}
            action={{
              label: "Turn the demo on",
              title: "Turn the demo on",
              explain: "Anyone can then try the demo from the website and the sign-in page, without a code, as one of the demo people. Nothing real can be seen or sent from it.",
              confirm: "Turn on",
              what: "turn the demo on",
              defaultReason: "",
              run: (reason) => setDemoSigninAction(true, reason),
            }}
          />
        )}
        {communities.map((c) => (
          <ReasonButton
            key={c.id}
            action={{
              label: `Start “${c.name}” over`,
              title: `Start ${c.name} over`,
              explain: "Puts the demo community back to how it is every morning. Whatever visitors changed goes. Running demos keep working.",
              confirm: "Start over",
              tone: "warn",
              what: "start the demo community over",
              defaultReason: "Start the demo community over",
              run: (reason) => resetDemoCommunityAction(c.id, reason),
            }}
          />
        ))}
      </div>
    </div>
  );
}
