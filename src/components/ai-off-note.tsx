import Link from "next/link";

import { AI_OFF, MARKETPLACE_HREF } from "@/lib/ai-gate";

/**
 * Why an AI feature is not here: iWeaver is not on for the community (0755). Says so in one sentence, what still works, and
 * where an administrator asks for it (Settings › Marketplace). Used wherever an AI button would be, never a silent gap.
 */
export function AiOffNote({ stillWorks, className = "" }: { stillWorks?: string; className?: string }) {
  return (
    <div role="status" data-testid="ai-off" className={`rounded-xl border border-saffron-200 bg-saffron-50 px-3 py-2.5 text-[13px] text-brown-900 ${className}`}>
      <p className="m-0 font-semibold">{AI_OFF}</p>
      <p className="m-0 mt-0.5">
        {stillWorks ? `${stillWorks} ` : ""}
        An administrator can ask for it in{" "}
        <Link href={MARKETPLACE_HREF} className="font-semibold text-navy underline">
          Settings › Marketplace
        </Link>
        .
      </p>
    </div>
  );
}
