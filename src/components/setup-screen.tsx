import type { ReactNode } from "react";

import { PRODUCT_NAME } from "@/lib/brand";
import type { EnvProblem } from "@/lib/env";

/** Full-page explanation when the app cannot run yet. No mock data, ever. */
export function SetupScreen({ problems }: { problems: EnvProblem[] }) {
  return (
    <CenteredPanel title={`${PRODUCT_NAME} needs to be configured`}>
      <p>
        This app talks to the Community Connect Supabase project. Set these environment variables (for local development put them
        in <code className="rounded bg-subtle px-1">.env.local</code>; see <code className="rounded bg-subtle px-1">.env.example</code>),
        then restart the server:
      </p>
      <ul className="mt-4 space-y-2">
        {problems.map((p) => (
          <li key={p.name} className="rounded-[10px] border border-danger/25 bg-danger-50 px-3 py-2 text-danger">
            <code className="font-semibold">{p.name}</code> {p.problem}
          </li>
        ))}
      </ul>
      <dl className="mt-6 space-y-3 text-sm">
        <div>
          <dt className="font-semibold">NEXT_PUBLIC_SUPABASE_URL</dt>
          <dd className="text-muted">The project URL, e.g. https://abcd.supabase.co (local: http://localhost:54321).</dd>
        </div>
        <div>
          <dt className="font-semibold">NEXT_PUBLIC_SUPABASE_ANON_KEY</dt>
          <dd className="text-muted">The project&apos;s anon (public) key. Never use the service-role key here.</dd>
        </div>
        <div>
          <dt className="font-semibold">NEXT_PUBLIC_CENTER_SLUG</dt>
          <dd className="text-muted">Which center this console serves (optional; defaults to &quot;jsh&quot;).</dd>
        </div>
      </dl>
    </CenteredPanel>
  );
}

export function CenteredPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="cc-card w-full max-w-xl p-8">
        <p className="cc-kicker">{PRODUCT_NAME}</p>
        <h1 className="mt-1 font-display text-2xl font-semibold text-ink">{title}</h1>
        <div className="mt-4 text-[0.9375rem] leading-relaxed text-ink">{children}</div>
      </div>
    </main>
  );
}
