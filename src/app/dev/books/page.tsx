import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PreviewShell } from "@/app/dev/admin-giving/preview-shell";
import { BooksView } from "@/components/books/books-page";
import { sampleBooks, type BooksSample } from "@/lib/books/fixtures";
import { devPreviewAllowed } from "@/lib/dev-preview";
import { TODAY_COMMUNITY } from "@/lib/giving-today/fixtures";

export const metadata: Metadata = { title: "Giving Books · Dev preview" };

type Search = Promise<Record<string, string | string[] | undefined>>;

const SAMPLES: readonly BooksSample[] = ["waiting", "clear", "no_access"];

/**
 * DEV ONLY. Giving › Books (New look) with invented data, drawn without a database or a session. `?state=waiting` (default):
 * card payouts and a refund wait, so two checks stay a person's; `?state=clear`: a cash-and-check month where every check but
 * the statements ticks itself; `?state=no_access`: a month-end closer who cannot see payments or postings (nothing ticks).
 * The buttons call the real Server Actions, which refuse without a session. Returns notFound() in production.
 */
export default async function BooksPreview({ searchParams }: { searchParams?: Search }) {
  if (!devPreviewAllowed()) notFound();
  const sp = (await searchParams) ?? {};
  const sample = SAMPLES.find((s) => s === sp.state) ?? "waiting";
  return (
    <PreviewShell community={TODAY_COMMUNITY} workspaces={[]}>
      <BooksView {...sampleBooks(sample)} />
    </PreviewShell>
  );
}
