import { redirect } from "next/navigation";

import { param, type RawSearchParams } from "@/lib/search-params";

/** The class list is the Pathshala Classes tab (one table, as in the prototype). */
export default async function ClassesIndex({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const term = param(await searchParams, "term");
  redirect(term ? `/pathshala?term=${encodeURIComponent(term)}` : "/pathshala");
}
