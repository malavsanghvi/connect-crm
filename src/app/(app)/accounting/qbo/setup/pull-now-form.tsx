"use client";

import { useState } from "react";

import { ActionForm } from "@/components/action-form";
import { RefreshWhileBusy } from "@/components/refresh-while-busy";

import { pullQboListsAction } from "./actions";

/**
 * "Pull now": queues the pull, then keeps the page fresh until a newer pull is on record (`lastPullAt` changes), at most a minute
 * (a finished pull is only written when it ends, so there is nothing else on the page to watch).
 */
export function PullNowForm({ lastPullAt }: { lastPullAt: string | null }) {
  const [since, setSince] = useState<{ at: string | null } | null>(null);
  const waiting = since !== null && since.at === lastPullAt;
  return (
    <div className="flex flex-col items-end gap-1">
      <ActionForm
        action={pullQboListsAction}
        submitLabel="Pull now"
        pendingLabel="Queuing…"
        variant="secondary"
        size="sm"
        onSuccess={() => setSince({ at: lastPullAt })}
      />
      <RefreshWhileBusy active={waiting} seconds={3} maxSeconds={60} />
    </div>
  );
}
