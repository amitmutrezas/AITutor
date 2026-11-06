import type { BuiltPrompt, HintModel, ModelCallOptions, ModelResult } from "./types";

const ENDPOINT = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

/**
 * Real HintModel via the Anthropic Messages API (plain fetch, no SDK dependency).
 * Server-only: reads ANTHROPIC_API_KEY at call time. Used by the route, never in tests.
 * Errors carry no prompt or code content.
 */
export function createAnthropicModel(fetchImpl: typeof fetch = fetch): HintModel {
  return {
    async complete(prompt: BuiltPrompt, opts: ModelCallOptions): Promise<ModelResult> {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
      const res = await fetchImpl(ENDPOINT, {
        method: "POST",
        signal: opts.signal,
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": API_VERSION,
        },
        body: JSON.stringify({
          model: opts.model,
          max_tokens: opts.maxTokens,
          system: prompt.system,
          messages: [{ role: "user", content: prompt.user }],
        }),
      });
      if (!res.ok) throw new Error(`anthropic request failed: ${res.status}`);
      const data = (await res.json()) as {
        content?: { type: string; text?: string }[];
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const text = (data.content ?? [])
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text)
        .join("");
      return {
        text,
        tokensIn: data.usage?.input_tokens ?? 0,
        tokensOut: data.usage?.output_tokens ?? 0,
      };
    },
  };
}
