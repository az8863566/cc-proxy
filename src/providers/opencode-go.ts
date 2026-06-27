import type { Provider, ProviderOverrides, AnthropicRequest } from "./base.js";
import type { ProviderConfig } from "../config.js";
import { anthropicToOpenAI } from "../conversion/anthropic-to-openai.js";
import { streamOpenAIResponse } from "../conversion/openai-sse-to-anthropic.js";

/**
 * OpenCode Go provider — uses OpenAI Chat Completions API.
 *
 * Known issue: Model-level options (reasoning/thinking) may be silently
 * dropped in headless mode (GitHub issue #27361).
 */
export class OpenCodeGoProvider implements Provider {
  readonly id = "opencode_go";

  constructor(private config: ProviderConfig) {}

  async *streamResponse(
    request: AnthropicRequest,
    signal?: AbortSignal,
    overrides?: ProviderOverrides,
  ): AsyncIterable<string> {
    const thinkingLevel = overrides?.thinkingLevel ?? this.config.thinkingLevel;
    const thinkingEnabled = thinkingLevel !== undefined ? thinkingLevel !== "off" : true;

    const openaiBody = anthropicToOpenAI(
      { ...request, model: this.config.defaultModel },
      { thinkingEnabled },
    );

    const temperature = overrides?.temperature ?? this.config.temperature;
    if (openaiBody.temperature === undefined && temperature !== undefined) {
      openaiBody.temperature = temperature;
    }

    const upstreamBody: Record<string, unknown> = { ...openaiBody };

    if (thinkingEnabled) {
      const level = thinkingLevel ?? "high";
      const effortMap: Record<string, string> = {
        off: "none",
        low: "minimal",
        high: "high",
        max: "xhigh",
      };
      upstreamBody.reasoning_effort = effortMap[level] ?? "high";
    }

    const url = `${this.config.baseUrl}/chat/completions`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(upstreamBody),
      signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `OpenCode Go upstream error ${response.status}: ${text.slice(0, 500)}`,
      );
    }

    if (!response.body) {
      throw new Error("OpenCode Go returned empty response body");
    }

    yield* streamOpenAIResponse(response, this.config.defaultModel, thinkingEnabled);
  }

  async listModels(): Promise<string[]> {
    return [this.config.defaultModel];
  }

  async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.defaultModel,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
        }),
      });
      return response.ok || response.status === 401 || response.status === 400;
    } catch {
      return false;
    }
  }
}
