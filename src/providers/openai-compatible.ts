import type { Provider, ProviderOverrides, AnthropicRequest, Usage, StreamHandle } from "./base.js";
import type { ProviderConfig } from "../config.js";
import { anthropicToOpenAI } from "../conversion/anthropic-to-openai.js";
import type { OpenAIChatRequest } from "../conversion/anthropic-to-openai.js";
import { streamOpenAIResponse } from "../conversion/openai-sse-to-anthropic.js";

/**
 * Base class for providers that use the OpenAI Chat Completions API.
 *
 * Handles the shared flow:
 *   anthropicToOpenAI → buildUpstreamBody → fetch → error check → streamOpenAIResponse
 *
 * Subclasses override hooks for provider-specific behaviour (effort maps,
 * thinking fields, temperature clamping, etc.).
 */
export abstract class OpenAICompatibleProvider implements Provider {
  abstract readonly id: string;

  constructor(
    protected config: ProviderConfig,
    private providerName: string,
  ) {}

  // ── Provider interface ──────────────────────────────────────────

  streamResponse(
    request: AnthropicRequest,
    signal?: AbortSignal,
    overrides?: ProviderOverrides,
  ): StreamHandle {
    let resolveUsage!: (u: Usage) => void;
    const usage = new Promise<Usage>((resolve) => { resolveUsage = resolve; });

    const self = this;
    async function* events(): AsyncGenerator<string> {
      const thinkingLevel = overrides?.thinkingLevel;
      const thinkingEnabled = thinkingLevel !== undefined ? thinkingLevel !== "off" : true;

      const openaiBody = anthropicToOpenAI(request, { thinkingEnabled });

      self.applyTemperature(openaiBody, overrides);

      const upstreamBody = self.buildUpstreamBody(
        openaiBody,
        thinkingEnabled,
        thinkingLevel,
      );

      const bodyStr = JSON.stringify(upstreamBody);
      const estimatedInputTokens = Math.max(1, Math.ceil(bodyStr.length / 4));

      const url = `${self.config.baseUrl}/chat/completions`;

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${self.config.apiKey}`,
        },
        body: bodyStr,
        signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(
          `${self.providerName} upstream error ${response.status}: ${text.slice(0, 500)}`,
        );
      }

      const result = streamOpenAIResponse(
        response,
        request.model,
        thinkingEnabled,
        estimatedInputTokens,
      );

      yield* result.events;
      resolveUsage(await result.usage);
    }

    return { events: events(), usage };
  }

  async listModels(): Promise<string[]> {
    return [];
  }

  async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.config.baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify({
            model: "health-check",
            messages: [{ role: "user", content: "ping" }],
            max_tokens: 1,
          }),
        },
      );
      return response.ok || response.status === 401 || response.status === 400;
    } catch {
      return false;
    }
  }

  // ── Hooks for subclasses ────────────────────────────────────────

  /** Apply temperature override if set. */
  protected applyTemperature(
    body: OpenAIChatRequest,
    overrides?: ProviderOverrides,
  ): void {
    if (body.temperature === undefined && overrides?.temperature !== undefined) {
      body.temperature = overrides.temperature;
    }
  }

  /**
   * Build the final upstream request body from the OpenAI Chat body.
   * Subclasses add provider-specific fields (thinking, reasoning_effort, etc.).
   */
  protected buildUpstreamBody(
    openaiBody: OpenAIChatRequest,
    thinkingEnabled: boolean,
    thinkingLevel: string | undefined,
  ): Record<string, unknown> {
    void thinkingLevel; // may be used by subclasses
    return { ...openaiBody };
  }
}
