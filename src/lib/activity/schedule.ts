import { after } from "next/server";

/**
 * Run `task` once the response has been sent (Next.js `after`), so recording never delays the page or the
 * action. Outside a request (a test, a script) `after` refuses; the task then runs on the next tick instead.
 * An error in the task is logged and goes no further.
 */
export function runAfterResponse(task: () => Promise<void> | void): void {
  const run = () => {
    try {
      const pending = task();
      if (pending && typeof pending.catch === "function") pending.catch(logTaskError);
    } catch (error) {
      logTaskError(error);
    }
  };
  try {
    after(run);
  } catch {
    setTimeout(run, 0);
  }
}

function logTaskError(error: unknown): void {
  console.error("[activity] a recording task failed:", error);
}
