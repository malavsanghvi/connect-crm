import Link from "next/link";

import { buttonClass } from "@/components/ui";

/**
 * The Events page's "New event" button. Classic look: the event builder, exactly as before. New look: the guided creator, with
 * the builder one tap away as "Advanced form".
 */
export function NewEventActions({ v2 }: { v2: boolean }) {
  if (!v2) {
    return (
      <Link href="/events/builder" className={buttonClass("primary")}>
        New event
      </Link>
    );
  }
  return (
    <>
      <Link href="/events/builder" className={buttonClass("ghost")}>
        Advanced form
      </Link>
      <Link href="/events/new" className={buttonClass("primary")}>
        New event
      </Link>
    </>
  );
}
