import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { DemoBanner } from "@/components/demo-banner";
import { AppShell } from "@/components/shell/app-shell";
import { CenteredPanel, SetupScreen } from "@/components/setup-screen";
import { PRODUCT_NAME } from "@/lib/brand";
import { countHomeTasks } from "@/lib/data/home-tasks";
import { isDemoEmail } from "@/lib/demo-signin/rules";
import { loadDemoBanner } from "@/lib/demo-signin/server";
import { LOOK_COOKIE, parseLook } from "@/lib/look";
import { centerMissingHint, enforceStaff2fa, loadSession } from "@/lib/session";

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const state = await loadSession();
  switch (state.status) {
    case "env_missing":
      return <SetupScreen problems={state.problems} />;
    case "signed_out":
      redirect("/login");
    case "center_missing":
      return (
        <CenteredPanel title="Center not found">
          <p>
            No active center has the slug <code className="rounded bg-subtle px-1">{state.slug}</code>.{" "}
            {centerMissingHint(state.source)} The center must exist in{" "}
            <code className="rounded bg-subtle px-1">app.centers</code> with status active or onboarding.
          </p>
          {state.source === "switcher" ? (
            <p className="mt-4">
              {/* A route handler, so the switcher cookie is cleared before the portal loads again. */}
              <a href="/api/tenancy/reset" className="crm-link font-semibold">
                Go back to the default community
              </a>
            </p>
          ) : null}
        </CenteredPanel>
      );
    case "error":
      return (
        <CenteredPanel title={`${PRODUCT_NAME} could not start`}>
          <p role="alert" className="text-danger">
            {state.message}.
          </p>
          <p className="mt-4">
            <Link href="/" prefetch={false} className="crm-link font-semibold">
              Try again
            </Link>
          </p>
        </CenteredPanel>
      );
    case "ok": {
      // Staff 2FA (security.require_2fa_for_staff): a staff session that has not
      // passed 2FA goes to Account › Security to set up or enter its code. The
      // database refuses sensitive changes on its own either way (assert_step_up).
      await enforceStaff2fa(state.session);
      const tasks = await countHomeTasks(state.session);
      // The person's own choice of look ("New look" in the user menu); anyone who never chose gets the classic portal.
      const look = parseLook((await cookies()).get(LOOK_COOKIE)?.value);
      // "Try the demo": while someone is in a demo session, every page says so and offers Switch role and Leave the demo.
      const inDemo = isDemoEmail(state.session.email);
      const demo = inDemo ? await loadDemoBanner(state.session.db) : null;
      return (
        <>
          {inDemo ? <DemoBanner info={demo} /> : null}
          <AppShell session={state.session} tasks={tasks} look={look}>
            {children}
          </AppShell>
        </>
      );
    }
  }
}
