import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "@/components/shell/app-shell";
import { CenteredPanel, SetupScreen } from "@/components/setup-screen";
import { loadSession } from "@/lib/session";

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
            No active center has the slug <code className="rounded bg-subtle px-1">{state.slug}</code>. Check{" "}
            <code className="rounded bg-subtle px-1">NEXT_PUBLIC_CENTER_SLUG</code>, and that the center exists in{" "}
            <code className="rounded bg-subtle px-1">app.centers</code> with status active or onboarding.
          </p>
        </CenteredPanel>
      );
    case "error":
      return (
        <CenteredPanel title="Connect CRM could not start">
          <p role="alert" className="text-maroon">
            {state.message}.
          </p>
          <p className="mt-4">
            <Link href="/" prefetch={false} className="crm-link font-semibold">
              Try again
            </Link>
          </p>
        </CenteredPanel>
      );
    case "ok":
      return <AppShell session={state.session}>{children}</AppShell>;
  }
}
