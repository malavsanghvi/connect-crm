"use client";

import { createContext, useContext } from "react";

import { findAction } from "@/app/(app)/search/find-actions";
import type { FindResult } from "@/lib/find/types";

export type FindSearch = (query: string) => Promise<FindResult>;

/** Where the box looks things up. The real one is the server action; the dev preview supplies one that reads invented sample data. */
export const FindBackendContext = createContext<FindSearch>(findAction);

export function useFindSearch(): FindSearch {
  return useContext(FindBackendContext);
}
