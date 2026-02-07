// ─────────────────────────────────────────────────────────────
// Temper – Coach LLM Layer (Architecture / Types Only)
// ─────────────────────────────────────────────────────────────
// This file defines the types and system prompt for the LLM
// coach layer. The actual LLM call is NOT wired — this is the
// interface contract and prompt engineering layer.
//
// The coach:
//   • ONLY consumes CoachFactsPayload
//   • NEVER computes scores or modifies labels
//   • NEVER invents numbers or trades
//   • NEVER gives trading signals
//   • Only produces narratives, reinforcement, and prompts
// ─────────────────────────────────────────────────────────────

import type { CoachFactsPayload } from "@/lib/types";

// ── Coach output types ────────────────────────────────────────

export interface CoachResponse {
  /** Opening summary of the trading day (2-3 sentences). */
  daySummary: string;

  /** Per-event breakdowns in natural language. */
  eventNarratives: {
    tradeIndex: number;
    narrative: string;
  }[];

  /** Positive reinforcement for good sequences. */
  positiveReinforcement: string[];

  /** Negative reinforcement for poor sequences. */
  negativeReinforcement: string[];

  /** Behavioral guardrails / actionable advice. */
  guardrails: string[];

  /** Journal prompts for self-reflection. */
  journalPrompts: string[];

  /** Overall encouragement or caution. */
  closingMessage: string;
}

// ── System prompt ─────────────────────────────────────────────

export const COACH_SYSTEM_PROMPT = `You are Temper Coach, a behavioral trading discipline coach.
You analyze structured trading session data and provide clear, supportive feedback.

RULES — you MUST follow these strictly:
1. You ONLY reference fields that exist in the JSON payload provided.
2. You NEVER invent numbers, trades, tickers, or P/L values.
3. You NEVER compute or modify scores — all numbers come from the payload.
4. You NEVER give trading signals (e.g., "buy AAPL tomorrow").
5. You use the chess-style symbols (!! ! !? 📖 ?! ? ?? ⨯) when referencing decisions.
6. You provide both positive AND negative reinforcement.
7. For guardrails, give concrete, actionable rules (e.g., "If you hit -2R, pause for 15 minutes").
8. Keep language direct and coach-like. Not preachy or robotic.
9. Reference specific trade indices and timestamps from the payload.
10. When mentioning streaks or tilt sequences, use the exact start/end indices provided.

TONE:
- Like a supportive but honest chess coach reviewing a game
- Celebrate !! and ! decisions with genuine enthusiasm
- Call out ?? and ? decisions firmly but constructively
- Always end on a forward-looking, improvement-oriented note

OUTPUT FORMAT:
Return a JSON object matching the CoachResponse interface exactly.`;

// ── Build prompt from facts ───────────────────────────────────

/**
 * Build the user prompt for the LLM from a CoachFactsPayload.
 * This is a deterministic string transformation.
 */
export function buildCoachPrompt(facts: CoachFactsPayload): string {
  return `Analyze this trading session and provide coaching feedback.

SESSION DATA:
${JSON.stringify(facts, null, 2)}

Respond with a JSON object containing:
- daySummary: 2-3 sentence overview
- eventNarratives: array of { tradeIndex, narrative } for the key events
- positiveReinforcement: array of encouraging observations
- negativeReinforcement: array of firm but constructive criticism
- guardrails: array of specific behavioral rules to implement
- journalPrompts: array of reflective questions
- closingMessage: forward-looking encouragement`;
}

// ── Mock coach for development ────────────────────────────────

/**
 * Generate a mock coach response for development/testing.
 * Produces deterministic output based on payload contents.
 */
export function mockCoachResponse(
  facts: CoachFactsPayload,
): CoachResponse {
  const { overview, biases, keyEvents, tiltSequences, disciplinedReplay } =
    facts;

  const triggeredBiases = biases.filter((b) => b.isTriggered);
  const blunders = keyEvents.filter((e) => e.label === "BLUNDER");
  const brilliants = keyEvents.filter((e) => e.label === "BRILLIANT");

  return {
    daySummary: `On ${overview.date}, you made ${overview.totalTrades} trades with a ${(overview.winRate * 100).toFixed(0)}% win rate and a Temper Score of ${overview.temperScore}/100. ${
      overview.eloDelta >= 0
        ? `Your discipline rating improved by ${overview.eloDelta} points.`
        : `Your discipline rating dropped by ${Math.abs(overview.eloDelta)} points.`
    }`,

    eventNarratives: keyEvents.slice(0, 5).map((e) => ({
      tradeIndex: e.tradeIndex,
      narrative: `Trade #${e.tradeIndex + 1} (${e.symbol}): ${e.explanation}`,
    })),

    positiveReinforcement: [
      ...(brilliants.length > 0
        ? [
            `Outstanding: ${brilliants.length} brilliant (${brilliants[0].symbol}) decision${brilliants.length > 1 ? "s" : ""} today.`,
          ]
        : []),
      ...(overview.temperScore >= 70
        ? ["Strong overall discipline — you stayed composed for most of the session."]
        : []),
      ...(disciplinedReplay.tradesRemoved === 0
        ? ["Every trade would have survived disciplined rules — great self-control."]
        : []),
    ],

    negativeReinforcement: [
      ...(blunders.length > 0
        ? [
            `${blunders.length} blunder${blunders.length > 1 ? "s" : ""} (${blunders[0].symbol}) detected — these are your biggest discipline failures today.`,
          ]
        : []),
      ...triggeredBiases.map(
        (b) =>
          `${b.type.replace("_", " ")} bias triggered (score: ${b.score}/100): ${b.topMetric}`,
      ),
      ...(tiltSequences.length > 0
        ? [
            `${tiltSequences.length} tilt sequence${tiltSequences.length > 1 ? "s" : ""} detected — periods where discipline broke down.`,
          ]
        : []),
    ],

    guardrails: [
      ...(triggeredBiases.some((b) => b.type === "REVENGE_TRADING")
        ? [
            "Rule: After any loss > 1R, wait 15 minutes before your next trade.",
          ]
        : []),
      ...(triggeredBiases.some((b) => b.type === "OVERTRADING")
        ? [
            `Rule: Cap yourself at ${Math.ceil(overview.totalTrades * 0.7)} trades tomorrow.`,
          ]
        : []),
      ...(disciplinedReplay.tradesRemoved > 0
        ? [
            `If you had followed basic discipline rules, you would have ${disciplinedReplay.savings >= 0 ? "saved" : "lost"} $${Math.abs(disciplinedReplay.savings).toFixed(2)}.`,
          ]
        : []),
    ],

    journalPrompts: [
      "What was your emotional state before the first losing trade?",
      ...(tiltSequences.length > 0
        ? [
            "What triggered the tilt sequence? Was there a specific trade that broke your composure?",
          ]
        : []),
      "If you could replay one trade differently, which would it be and why?",
      "What rule would have prevented your worst decision today?",
    ],

    closingMessage:
      overview.temperScore >= 70
        ? "Good session overall. Keep building on your discipline streaks and the rating will follow."
        : "Tough day for discipline, but recognizing the patterns is the first step. Focus on one rule tomorrow and own it.",
  };
}
