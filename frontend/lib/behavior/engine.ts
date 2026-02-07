// ─────────────────────────────────────────────────────────────
// Temper – Behavior Engine (Orchestrator)
// ─────────────────────────────────────────────────────────────
// Top-level pure function that runs the full analysis pipeline
// for a single session:
//
//   Session + UserBaseline
//     → bias scores
//     → decision labels
//     → temper score
//     → disciplined replay
//     → ELO update
//     → coach facts
//     → TemperReport
//
// All sub-functions are pure and side-effect-free.
// ─────────────────────────────────────────────────────────────

import type {
  Session,
  UserBaseline,
  DecisionEloState,
  TemperReport,
  DisciplinedReplayRules,
} from "@/lib/types";
import { DEFAULT_BASELINE, DEFAULT_REPLAY_RULES } from "@/lib/types";
import { computeAllBiases } from "./biases";
import { labelTrades } from "./labels";
import { computeTemperScore } from "./temper-score";
import { updateDecisionElo, DEFAULT_ELO_STATE } from "@/lib/ratings/elo";
import { runDisciplinedReplay } from "@/lib/replay/disciplined";
import { v5 as uuidv5 } from "uuid";

const REPORT_UUID_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

export interface AnalyzeSessionInput {
  session: Session;
  baseline?: UserBaseline;
  previousElo?: DecisionEloState;
  replayRules?: DisciplinedReplayRules;
}

export interface AnalyzeSessionOutput {
  report: TemperReport;
  newElo: DecisionEloState;
}

/**
 * Run the full behavioral analysis pipeline for a session.
 * Pure function — deterministic for the same inputs.
 */
export function analyzeSession(
  input: AnalyzeSessionInput,
): AnalyzeSessionOutput {
  const {
    session,
    baseline = DEFAULT_BASELINE,
    previousElo = DEFAULT_ELO_STATE,
    replayRules = DEFAULT_REPLAY_RULES,
  } = input;

  // 1. Compute bias scores
  const { scores: biasScores, details: biasDetails } = computeAllBiases(
    session,
    baseline,
  );

  // 2. Label each trade
  const decisions = labelTrades(session, baseline);

  // 3. Compute Temper Score
  const temperScore = computeTemperScore(decisions, biasScores);

  // 4. Run disciplined replay
  const disciplinedReplay = runDisciplinedReplay(
    session,
    baseline,
    replayRules,
  );

  // 5. Update decision ELO
  const newElo = updateDecisionElo(previousElo, decisions, session.date);

  // 6. Assemble report
  const reportId = uuidv5(
    `report-${session.id}-${session.date}`,
    REPORT_UUID_NAMESPACE,
  );

  const report: TemperReport = {
    id: reportId,
    sessionId: session.id,
    userId: session.userId,
    date: session.date,
    session,
    biasScores,
    biasDetails,
    decisions,
    temperScore,
    eloBefore: previousElo.rating,
    eloAfter: newElo.rating,
    eloDelta: newElo.lastSessionDelta,
    disciplinedReplay,
    generatedAt: new Date().toISOString(),
  };

  return { report, newElo };
}

/**
 * Re-export sub-modules for direct access if needed.
 */
export { computeAllBiases } from "./biases";
export { labelTrades } from "./labels";
export { computeTemperScore } from "./temper-score";
