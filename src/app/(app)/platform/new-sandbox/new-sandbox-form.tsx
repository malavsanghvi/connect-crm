"use client";

import Link from "next/link";
import { useId, useState, useTransition, type FormEvent } from "react";

import { useStepUp } from "@/components/step-up";
import { useToast } from "@/components/toast";
import { StatusText, buttonClass } from "@/components/ui";
import type { ActionResult } from "@/lib/errors";
import { ORG_TYPES, suggestSlug } from "@/lib/platform-onboarding";
import { baseSlug, invitationEmailText, sandboxSlug } from "@/lib/platform-sandbox";

import { createSandboxAction, type CreatedSandbox } from "./actions";

/** The created sandbox and the owner's invitation link (shown once: the database keeps only its hash). */
function Created({ r }: { r: CreatedSandbox }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const mail = invitationEmailText(r.emailStatus, r.ownerEmail);
  return (
    <div className="mt-4 rounded-[12px] border border-success/30 bg-success-50 p-4 text-[13px] text-success-900" role="status" data-testid="sandbox-created">
      <p className="font-bold">
        Sandbox created: <span className="font-mono">{r.slug}</span>
      </p>
      <p className="mt-1" data-testid="invitation-email-status">
        <StatusText tone={mail.tone}>{mail.text}</StatusText>
      </p>
      <p className="mt-2">
        The link makes the person who accepts it the owner. It works once, only for {r.ownerEmail}, until{" "}
        {r.expiresAt ? new Date(r.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "it expires"}. It is not shown again.
      </p>
      <input readOnly value={r.link} data-testid="owner-invitation-link" aria-label="Owner invitation link" className="crm-input mt-2 font-mono text-[12px]" onFocus={(e) => e.currentTarget.select()} />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={buttonClass("ghost", "sm")}
          onClick={() => {
            navigator.clipboard.writeText(r.link).then(
              () => setCopied(true),
              (err) => {
                console.error("[platform/new-sandbox] copy failed:", err);
                toast?.show("Could not copy — select the link and copy it by hand.", "bad");
              },
            );
          }}
        >
          {copied ? "Copied ✓" : "Copy link"}
        </button>
        <Link href={`/platform/centers/${r.centerId}`} className={buttonClass("ghost", "sm")}>
          Limits &amp; addresses
        </Link>
        <Link href="/platform/pipeline" className={buttonClass("ghost", "sm")}>
          Onboarding pipeline
        </Link>
      </div>
    </div>
  );
}

export function NewSandboxForm() {
  const id = useId();
  const toast = useToast();
  const stepUp = useStepUp();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedSandbox | null>(null);
  const [pending, start] = useTransition();
  const shownSlug = slugTouched ? slug : suggestSlug(name);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const s = (k: string) => String(fd.get(k) ?? "");
    const input = {
      name: s("name"),
      slug: s("slug"),
      orgType: s("org_type"),
      city: s("city"),
      state: s("state"),
      ownerFirstName: s("owner_first_name"),
      ownerLastName: s("owner_last_name"),
      ownerEmail: s("owner_email"),
      reason: s("reason"),
    };
    setError(null);
    start(async () => {
      try {
        const call = () => createSandboxAction(input);
        const res: ActionResult<CreatedSandbox> = stepUp ? await stepUp.run(call, "Creating a sandbox") : await call();
        if (!res.ok || !res.data) {
          const msg = res.ok ? "Could not create the sandbox — nothing came back. Reload Platform › Centers to check." : res.error;
          setError(msg);
          toast?.show(msg, "bad");
          return;
        }
        setCreated(res.data);
        toast?.show(res.message ?? "Sandbox created", "ok");
        form.reset();
        setName("");
        setSlug("");
        setSlugTouched(false);
      } catch (err) {
        console.error("[platform/new-sandbox] create failed:", err);
        setError("Could not create the sandbox — the server did not respond. Reload Platform › Centers to check whether it was created before trying again.");
      }
    });
  }

  return (
    <>
      <form onSubmit={submit} noValidate className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-busy={pending}>
        <div className="sm:col-span-2">
          <label htmlFor={`${id}-name`} className="crm-label">
            Organization name
          </label>
          <input id={`${id}-name`} name="name" className="crm-input" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jain Center of Dallas" />
        </div>
        <div>
          <label htmlFor={`${id}-slug`} className="crm-label">
            Web name
          </label>
          <input
            id={`${id}-slug`}
            name="slug"
            className="crm-input font-mono"
            autoComplete="off"
            value={shownSlug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value);
            }}
          />
          <p className="crm-hint" data-testid="sandbox-slug-preview">
            {shownSlug ? `Created as ${sandboxSlug(shownSlug)}; "${baseSlug(shownSlug)}" is kept for production.` : "Lowercase letters, numbers and dashes."}
          </p>
        </div>
        <div>
          <label htmlFor={`${id}-type`} className="crm-label">
            Kind of organization
          </label>
          <select id={`${id}-type`} name="org_type" className="crm-input" defaultValue="temple">
            {ORG_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-city`} className="crm-label">
            City
          </label>
          <input id={`${id}-city`} name="city" className="crm-input" autoComplete="off" />
        </div>
        <div>
          <label htmlFor={`${id}-state`} className="crm-label">
            State
          </label>
          <input id={`${id}-state`} name="state" className="crm-input w-24 uppercase" maxLength={2} autoComplete="off" placeholder="TX" />
        </div>
        <div>
          <label htmlFor={`${id}-first`} className="crm-label">
            Owner&apos;s first name
          </label>
          <input id={`${id}-first`} name="owner_first_name" className="crm-input" autoComplete="off" />
        </div>
        <div>
          <label htmlFor={`${id}-last`} className="crm-label">
            Owner&apos;s last name
          </label>
          <input id={`${id}-last`} name="owner_last_name" className="crm-input" autoComplete="off" />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={`${id}-email`} className="crm-label">
            Owner&apos;s email
          </label>
          <input id={`${id}-email`} name="owner_email" type="email" className="crm-input" autoComplete="off" />
          <p className="crm-hint">They receive an invitation; accepting it makes them the organization&apos;s owner and opens its Setup.</p>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={`${id}-reason`} className="crm-label">
            Reason
          </label>
          <input id={`${id}-reason`} name="reason" className="crm-input" maxLength={500} autoComplete="off" placeholder="For example: signed up at the JAINA convention" />
          <p className="crm-hint">Goes in the audit log. Creating a sandbox needs a fresh 2FA check.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
          <button type="submit" className={buttonClass("primary")} disabled={pending}>
            {pending ? "Creating…" : "Create sandbox"}
          </button>
        </div>
      </form>
      {error ? (
        <p role="alert" className="mt-3 rounded-[10px] border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
          {error}
        </p>
      ) : null}
      {created ? <Created r={created} /> : null}
    </>
  );
}
