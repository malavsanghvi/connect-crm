// Every tour there is. To add one: write a TourDef in this folder, list it here, and put the `data-spotlight` attributes it names on
// the real elements (docs/SPOTLIGHT.md, "How to add a tour").

import type { TourDef } from "../types";

import { TREASURER_BANK_MATCH } from "./treasurer-bank-match";

export const TOURS: readonly TourDef[] = [TREASURER_BANK_MATCH];
