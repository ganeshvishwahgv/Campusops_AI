import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";

// Claude interprets and explains. Deterministic backend code still enforces
// permissions, capacity, availability and state transitions before anything changes.
export const AI_MODEL = process.env.CAMPUSOPS_AI_MODEL || "claude-opus-5-5";

let client: Anthropic | null = null;

export function aiEnabled(): boolean {
  if (process.env.CAMPUSOPS_AI_DISABLED === "true") return false;
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

function anthropic() {
  client ??= new Anthropic({ timeout: 45_000, maxRetries: 1 });
  return client;
}

export class AiUnavailableError extends Error {}

const SYSTEM_BASE = `You are the operations assistant inside CampusOps, the facilities and recovery workspace for Easwari Engineering College, Chennai.
Ground every statement in the JSON facts supplied. Never invent rooms, buses, people, counts or times that are not present.
When you must choose, choose only among the candidate IDs supplied; deterministic rules have already checked eligibility.
Write for busy operations staff: short, concrete, and plain English. Times are India Standard Time.`;

/** One structured Claude call. Throws AiUnavailableError so callers can fall back to rules. */
export async function structured<T extends z.ZodType>(
  schema: T,
  task: string,
  facts: unknown,
  options: { maxTokens?: number; effort?: "low" | "medium" | "high" } = {},
): Promise<z.infer<T>> {
  if (!aiEnabled()) throw new AiUnavailableError("AI is not configured.");
  try {
    const response = await anthropic().beta.messages.parse({
      model: AI_MODEL,
      max_tokens: options.maxTokens ?? 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: options.effort ?? "low", format: betaZodOutputFormat(schema) },
      system: SYSTEM_BASE,
      messages: [{ role: "user", content: `${task}\n\n<facts>\n${JSON.stringify(facts)}\n</facts>` }],
    });
    if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens" || !response.parsed_output) {
      throw new AiUnavailableError(`AI response was not usable (${response.stop_reason}).`);
    }
    return response.parsed_output as z.infer<T>;
  } catch (error) {
    if (error instanceof AiUnavailableError) throw error;
    if (error instanceof Anthropic.AuthenticationError) console.error("Claude API key was rejected; using rule-based fallback.");
    else if (error instanceof Anthropic.RateLimitError) console.error("Claude API rate limited; using rule-based fallback.");
    else if (error instanceof Anthropic.APIError) console.error(`Claude API error ${error.status}; using rule-based fallback.`);
    else console.error("Claude request failed; using rule-based fallback.");
    throw new AiUnavailableError("AI request failed.");
  }
}

export type Provenance = { source: "CLAUDE" | "RULES"; model: string | null; generatedAt: string; notice: string | null };

export function provenance(source: "CLAUDE" | "RULES", failed = false): Provenance {
  return {
    source,
    model: source === "CLAUDE" ? AI_MODEL : null,
    generatedAt: new Date().toISOString(),
    notice: source === "CLAUDE" ? null
      : aiEnabled() || failed ? "Claude was unavailable for this request, so built-in rules produced this result."
      : "Claude is not configured (set ANTHROPIC_API_KEY). Built-in rules produced this result.",
  };
}

/** Run Claude, and if it is unavailable return the deterministic fallback instead. */
export async function withFallback<T>(ai: () => Promise<T>, rules: () => T | Promise<T>): Promise<T & Provenance> {
  if (aiEnabled()) {
    try { return { ...(await ai()), ...provenance("CLAUDE") }; } catch { return { ...(await rules()), ...provenance("RULES", true) }; }
  }
  return { ...(await rules()), ...provenance("RULES") };
}

// Small per-user window so a stuck client cannot run up model spend.
const windows = new Map<string, { count: number; resetAt: number }>();
export function aiRateLimited(userId: string, limit = 40): boolean {
  const now = Date.now();
  const entry = windows.get(userId);
  if (!entry || entry.resetAt <= now) { windows.set(userId, { count: 1, resetAt: now + 60_000 }); return false; }
  entry.count += 1;
  return entry.count > limit;
}
