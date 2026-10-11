import { revalidatePath } from "next/cache";

/**
 * Tell the portal that screens showing this data are out of date. A refresh that cannot be scheduled (a call outside a request) is
 * logged, never silent, and never turns a done action into a failed one.
 */
export function revalidateAfterCommand(paths: readonly string[]): void {
  for (const path of paths) {
    try {
      revalidatePath(path, "layout");
    } catch (error) {
      console.error(`[commands] could not refresh ${path} after the change; reload the screen to see it:`, error);
    }
  }
}
