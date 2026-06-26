import type { Provider, ProviderOverrides, AnthropicRequest } from "./base.js";
import type { ProviderConfig } from "../config.js";
import { anthropicToOpenAI } from "../conversion/anthropic-to-openai.js";
import { streamOpenAIResponse } from "../conversion/openai-sse-to-anthropic.js";

/**
 * Zhipu (智谱) GLM provider — uses OpenAI Chat Completions API.
 *
 * Converts Anthropic Messages → OpenAI Chat Completions, then
 * converts OpenAI SSE stream back to Anthropic SSE.
 */
export class ZhipuProvider implements Provider {
  readonly id = "zhipu";

  constructor(private config: ProviderConfig) {}

  async *streamResponse(
    request: AnthropicRequest,
    signal?: AbortSignal,
    overrides?: ProviderOverrides,
  ): AsyncIterable<string> {
    const thinkingLevel = overrides?.thinkingLevel ?? this.config.thinkingLevel;
    const thinkingEnabled = thinkingLevel !== undefined ? thinkingLevel !== "off" : true;

    const openaiBody = anthropicToOpenAI(
      { ...request as unknown as Record<string, unknown>, model: this.config.defaultModel },
      { thinkingEnabled },
    );

    const temperature = overrides?.temperature ?? this.config.temperature;
    if (openaiBody.temperature === undefined && temperature !== undefined) {
      let temp = temperature;
      if (temp <= 0) temp = 0.01;
      if (temp >= 1) temp = 0.99;
      openaiBody.temperature = temp;
    }

    const upstreamBody: Record<string, unknown> = { ...openaiBody };

    if (thinkingEnabled) {
      upstreamBody.thinking = { type: "enabled" };
      if (this.config.defaultModel === "glm-5.2") {
        const level = thinkingLevel ?? "high";
        const effortMap: Record<string, string> = {
          low: "high",   // GLM maps low → high
          high: "high",
          max: "max",
        };
        upstreamBody.reasoning_effort = effortMap[level] ?? "high";
      }
    } else {
      upstreamBody.thinking = { type: "disabled" };
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
        `Zhipu upstream error ${response.status}: ${text.slice(0, 500)}`,
      );
    }

    if (!response.body) {
      throw new Error("Zhipu returned empty response body");
    }

    // Process OpenAI SSE stream → Anthropic SSE
    yield* streamOpenAIResponse(response, this.config.defaultModel, thinkingEnabled);
  }

  async listModels(): Promise<string[]> {
    return [this.config.defaultModel];
  }

  async checkHealth(): Promise<boolean> {
    try {
      // Zhipu doesn't have a /models endpoint that works easily;
      // check by making a minimal API call or just verify connectivity
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
      // 401 = valid auth (just bad request), 200/400 also means reachable
      return response.ok || response.status === 401 || response.status === 400;
    } catch {
      return false;
    }
  }
}
