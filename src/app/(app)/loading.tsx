import { Skeleton } from "@/components/ui";

/** Shown while a page in the portal loads: the prototype's shimmer blocks (90px, then 260px). */
export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-3">
      <span className="sr-only">Loading…</span>
      <div className="mb-1 flex flex-col gap-2">
        <Skeleton height={34} className="w-64 max-w-full rounded-[10px]" />
        <Skeleton height={14} className="w-96 max-w-full rounded-md" />
      </div>
      <Skeleton height={90} />
      <Skeleton height={260} />
    </div>
  );
}
