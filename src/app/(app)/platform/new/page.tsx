import type { Metadata } from "next";
import Link from "next/link";

import { Alert, Card, PageHeader, QueryError } from "@/components/ui";
import { isPlainObject } from "@/lib/center-rules";
import { WIZARD_STEP_COUNT, WIZARD_STEPS, wizardStep } from "@/lib/center-wizard";
import { isUuid, param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";
import { mergeReadiness } from "@/lib/setup";

import { ReadinessTable } from "../../setup/readiness/readiness-table";

import { PlatformNoAccess } from "../platform-no-access";
import { WizardForm, type WizardCenter } from "./wizard-form";

export const metadata: Metadata = { title: "New center · Platform" };

function str(obj: unknown, key: string): string {
  const v = isPlainObject(obj) ? obj[key] : undefined;
  return typeof v === "string" ? v : "";
}

export default async function NewCenterWizardPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const header = <PageHeader title="Platform" description="Onboard a new center without developers" />;
  if (!session.isPlatformAdmin) {
    return (
      <>
        {header}
        <PlatformNoAccess />
      </>
    );
  }
  const sp = await searchParams;
  const { db } = session;
  const centerParam = param(sp, "center");
  let center: WizardCenter | null = null;
  let status: string | null = null;
  let storedStep: number | null = null;
  if (centerParam && isUuid(centerParam)) {
    const res = await db
      .from("centers")
      .select("id, name, slug, time_zone, tradition, state_region, rules, status")
      .eq("id", centerParam)
      .maybeSingle();
    if (res.error) {
      return (
        <>
          {header}
          <QueryError what="the center" error={res.error} retryHref="/platform/new" />
        </>
      );
    }
    if (res.data) {
      const r = res.data;
      status = r.status;
      storedStep = wizardStep(r.rules);
      const onboarding = isPlainObject(r.rules) ? r.rules.onboarding : undefined;
      const accounting = isPlainObject(r.rules) ? r.rules.accounting : undefined;
      center = {
        id: r.id,
        name: r.name,
        slug: String(r.slug),
        timeZone: r.time_zone,
        tradition: r.tradition,
        stateRegion: r.state_region ?? "",
        basis: str(accounting, "basis"),
        importSource: str(onboarding, "import_source"),
      };
    }
  }
  const stepParam = Number(param(sp, "step"));
  const step = Number.isInteger(stepParam) && stepParam >= 1 && stepParam <= WIZARD_STEP_COUNT ? stepParam : (storedStep ?? 1);
  const saved = Number(param(sp, "saved"));

  const roles = await db.from("roles").select("key", { count: "exact", head: true }).in("tier", ["center", "operational"]);
  if (roles.error) console.error("[platform] could not count default roles:", roles.error);

  // Step 6 shows the center's own go-live readiness (the same checks as its Setup › Go-live readiness).
  let readiness: React.ReactNode = null;
  if (step === WIZARD_STEP_COUNT && center) {
    const r = await db.rpc("readiness", { p_center: center.id });
    readiness = r.error ? <QueryError what="the readiness checks" error={r.error} retryHref={`/platform/new?center=${center.id}&step=${step}`} /> : <ReadinessTable rows={mergeReadiness(r.data ?? [])} links={false} />;
  }

  const stepHref = (i: number) => `/platform/new?${center ? `center=${center.id}&` : ""}step=${i}`;

  return (
    <>
      {header}
      {centerParam && !center ? (
        <div className="mb-4">
          <Alert tone="danger" title="That center was not found">
            Start a new center from step 1, or open an onboarding center from the Centers list.
          </Alert>
        </div>
      ) : null}
      {center && status !== "onboarding" ? (
        <div className="mb-4">
          <Alert tone="info" title={`${center.name} is ${status === "active" ? "live" : status}`}>
            The wizard only changes centers that are still onboarding.
          </Alert>
        </div>
      ) : null}
      {Number.isInteger(saved) && saved >= 1 && saved <= WIZARD_STEP_COUNT && center ? (
        <div className="mb-4">
          <Alert tone="success">
            {saved === 1 ? `${center.name} is saved as an onboarding center.` : `Step ${saved} · ${WIZARD_STEPS[saved - 1]} saved.`} Continue with step {step}.
          </Alert>
        </div>
      ) : null}
      <Card className="mb-4">
        <nav aria-label="Wizard steps" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {WIZARD_STEPS.map((label, i) => {
            const n = i + 1;
            const reached = n <= step;
            return (
              <Link
                key={label}
                href={stepHref(n)}
                aria-current={n === step ? "step" : undefined}
                className={`border-t-4 pr-2 pt-2 text-[13px] font-bold no-underline ${reached ? "border-navy text-navy" : "border-line text-faint"}`}
              >
                {n} · {label}
              </Link>
            );
          })}
        </nav>
      </Card>
      <Card title={WIZARD_STEPS[step - 1]}>
        <WizardForm key={`${step}-${center?.id ?? "new"}`} step={step} center={center} roleCount={roles.error ? null : (roles.count ?? null)} locked={Boolean(center && status !== "onboarding")} readiness={readiness} />
      </Card>
    </>
  );
}
