import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "@/components/shell/app-shell";
import { CenteredPanel, SetupScreen } from "@/components/setup-screen";
import { PRODUCT_NAME } from "@/lib/brand";
import { countHomeTasks } from "@/lib/data/home-tasks";
import { centerMissingHint, loadSession } from "@/lib/session";

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
      const tasks = await countHomeTasks(state.session);
      return (
        <AppShell session={state.session} tasks={tasks}>
          {children}
        </AppShell>
      );
    }
  }
}
