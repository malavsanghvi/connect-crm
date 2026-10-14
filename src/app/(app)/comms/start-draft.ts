"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { FormAction } from "@/components/action-form";
import { useToast } from "@/components/toast";
import { guardStalePage } from "@/lib/stale-page";

/**
 * Run an action that makes a new draft (copy a communication, or start from a template) and open the draft in the composer. The
 * failure stays on screen in plain English until the next try, and the same call can be run again. Nothing is opened unless the
 * server said the draft exists.
 */
export function useStartDraft() {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(action: FormAction, id: string, doing: string, onOpen?: () => void) {
    setError(null);
    start(async () => {
      try {
        const fd = new FormData();
        fd.set("id", id);
        const res = await guardStalePage(action)(null, fd);
        if (!res.ok || !res.data?.id) {
          const message = res.ok ? `Could not ${doing} — the server did not say where the new draft is. Check the list before trying again.` : res.error;
          setError(message);
          toast?.show(message, "bad");
          return;
        }
        if (res.message) toast?.show(res.message, "ok");
        onOpen?.();
        router.push(`/comms/campaigns/${res.data.id}`);
      } catch (err) {
        console.error(`[comms] ${doing} failed:`, err);
        const message = `Could not ${doing} — the server did not respond. Reload the page to see whether it went through before trying again.`;
        setError(message);
        toast?.show(message, "bad");
      }
    });
  }

  return { pending, error, setError, run };
}
