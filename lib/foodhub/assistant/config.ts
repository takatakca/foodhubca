// Food Hub Assistant — which Claude model answers, and whether AI is set up at all.
//   - ANTHROPIC_API_KEY comes from the environment only (never written in code, never sent to the browser).
//   - ANTHROPIC_MODEL picks the model; the default is Claude Sonnet 5.5 (fast, strong at tool use, low cost per chat).
//   - Without a key the panel still works: page summaries, next steps and nudges come from built-in rules (suggest.ts).

export const ASSISTANT_DEFAULT_MODEL = 'claude-sonnet-5-5';

export function assistantModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.ANTHROPIC_MODEL?.trim() || ASSISTANT_DEFAULT_MODEL;
}

export function assistantConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.ANTHROPIC_API_KEY?.trim());
}

export type AssistantEffort = 'low' | 'medium' | 'high';

/** FOODHUB_ASSISTANT_EFFORT (low | medium | high). Medium suits a chat that calls several tools per answer. */
export function assistantEffort(env: NodeJS.ProcessEnv = process.env): AssistantEffort {
  const e = env.FOODHUB_ASSISTANT_EFFORT?.trim();
  return e === 'low' || e === 'high' ? e : 'medium';
}

/** Current Claude models that take `output_config.effort` (older ones reject it). */
export function supportsEffort(model: string): boolean {
  return /^claude-(sonnet-5|opus-5|opus-4-[678]|fable-5|mythos-5|haiku-5)/.test(model);
}

/** Models that accept the server-side refusal fallback in its `"default"` form on the Claude API. */
export function supportsDefaultFallback(model: string): boolean {
  return /^claude-(sonnet-5-5|opus-5-5|opus-5$|opus-5-|fable-5-1)/.test(model);
}

/** How many model round trips one question may take (each read tool answer is one more round trip). */
export const MAX_STEPS = 8;
/** Messages of a chat replayed to the model (older ones stay visible in the panel, not in the prompt). */
export const HISTORY_WINDOW = 24;
