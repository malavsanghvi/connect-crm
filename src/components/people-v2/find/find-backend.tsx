"use client";

import { createContext, useContext } from "react";

import { findAction } from "@/app/(app)/search/find-actions";
import type { FindScope } from "@/lib/find/giving";
import type { FindResult } from "@/lib/find/types";

/** `scope` "giving" on Giving pages: the Giving lane looks wider there (campaigns, bank lines, a bare amount). */
export type FindSearch = (query: string, opts?: { scope?: FindScope }) => Promise<FindResult>;

/** Where the box looks things up. The real one is the server action; the dev preview supplies one that reads invented sample data. */
export const FindBackendContext = createContext<FindSearch>(findAction);

export function useFindSearch(): FindSearch {
  return useContext(FindBackendContext);
}
