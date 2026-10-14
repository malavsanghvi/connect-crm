import { PledgesView } from "@/components/giving-lists/pledges-view";
import { loadPledgesList } from "@/lib/data/giving-lists";
import type { RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

/** Giving › Pledges in the New look (docs/GIVING_REDESIGN.md section 4, slice 3). The loader says what this person may see. */
export async function PledgesV2({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  return <PledgesView model={await loadPledgesList(session, await searchParams)} />;
}
