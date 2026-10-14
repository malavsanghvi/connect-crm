// What a run measured: how much was decided without a person, how many questions it cost, and how long a person will need.
// These are the numbers the owner watches (share resolved automatically, questions per 1,000 rows, minutes), so they are
// computed from the run's own results and nothing else. The time estimate rests on the per-item seconds in config.budget.

import type { ResolveConfig } from "./config";
import { SIGNATURES, type ExceptionGroup, type QuestionBudget } from "./exceptions";
import type { ClassifiedPair, Hub, RecordDisposition, Tier } from "./types";

export type RunMetrics = {
  rows: number;
  /** Rows decided by code with no person involved (linked automatically, or new with nothing to ask). */
  auto: number;
  /** Rows waiting for a bulk "approve all" review (tier B). */
  bulk: number;
  /** Rows that are the subject of a question (tier C). */
  asked: number;
  /** Rows held for a person (tier D). */
  held: number;
  /** Rows answered by a remembered rule. */
  learned: number;
  linkedAutomatically: number;
  newRecords: number;
  duplicateGiftsSkipped: number;
  /** auto / rows, 0..1. */
  autoShare: number;
  /** auto / (rows that code is allowed to decide): children and other held rows are left out of the denominator. */
  autoShareOfUnheld: number;
  /** (auto + learned) / rows: what no person had to touch in this run. */
  withoutPersonShare: number;
  pairsByTier: Record<Tier, number>;
  /** Questions after grouping. */
  questions: number;
  questionsPer1000: number;
  questionTarget: number;
  withinQuestionTarget: boolean;
  /** Items inside the groups (a question can cover many). */
  itemsInQuestions: number;
  /** Estimated minutes of a person's time for this run, and per 1,000 rows. */
  minutes: number;
  minutesPer1000: number;
  withinMinuteTarget: boolean;
  /** Phones, e-mails, addresses or IDs shared by so many rows that they were not used as evidence. */
  hubs: number;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

export function computeMetrics(args: {
  dispositions: readonly RecordDisposition[];
  pairs: readonly ClassifiedPair[];
  groups: readonly ExceptionGroup[];
  budget: QuestionBudget;
  hubs: readonly Hub[];
  cfg: ResolveConfig;
}): RunMetrics {
  const { dispositions, pairs, groups, budget, hubs, cfg } = args;
  const rows = dispositions.length;
  const count = (status: RecordDisposition["status"]) => dispositions.filter((d) => d.status === status).length;
  const auto = count("auto");
  const bulk = count("bulk");
  const asked = count("asked");
  const held = count("held");
  const learned = count("learned");
  const pairsByTier: Record<Tier, number> = { A: 0, B: 0, C: 0, D: 0 };
  for (const p of pairs) pairsByTier[p.tier] += 1;
  const itemsInQuestions = groups.reduce((n, g) => n + g.items.length, 0);
  const heldGroups = groups.filter((g) => g.tier === "D");
  const heldMoney = heldGroups.filter((g) => SIGNATURES[g.signature].money).reduce((n, g) => n + g.items.length, 0);
  const heldOther = heldGroups.filter((g) => !SIGNATURES[g.signature].money).reduce((n, g) => n + g.items.length, 0);
  const seconds =
    budget.questions * cfg.budget.secondsPerQuestion +
    bulk * cfg.budget.secondsPerBulkRow +
    heldMoney * cfg.budget.secondsPerHeldMoneyItem +
    heldOther * cfg.budget.secondsPerHeldOtherItem;
  const minutes = round1(seconds / 60);
  const minutesPer1000 = rows > 0 ? round1((minutes * 1000) / rows) : 0;
  return {
    rows,
    auto,
    bulk,
    asked,
    held,
    learned,
    linkedAutomatically: dispositions.filter((d) => d.status === "auto" && d.how === "linked").length,
    newRecords: dispositions.filter((d) => d.how === "new").length,
    duplicateGiftsSkipped: dispositions.filter((d) => d.how === "duplicate_gift").length,
    autoShare: rows > 0 ? auto / rows : 1,
    autoShareOfUnheld: rows - held > 0 ? auto / (rows - held) : 1,
    withoutPersonShare: rows > 0 ? (auto + learned) / rows : 1,
    pairsByTier,
    questions: budget.questions,
    questionsPer1000: budget.perThousand,
    questionTarget: budget.target,
    withinQuestionTarget: budget.withinTarget,
    itemsInQuestions,
    minutes,
    minutesPer1000,
    withinMinuteTarget: minutesPer1000 <= cfg.budget.minutesPer1000,
    hubs: hubs.length,
  };
}
