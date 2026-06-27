import type { Provider, ProviderOverrides, AnthropicRequest } from "./base.js";
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

    this.applyTemperature(openaiBody, overrides);

    const upstreamBody = this.buildUpstreamBody(
      openaiBody,
      thinkingEnabled,
      thinkingLevel,
    );

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
        `${this.providerName} upstream error ${response.status}: ${text.slice(0, 500)}`,
      );
    }

    if (!response.body) {
      throw new Error(`${this.providerName} returned empty response body`);
    }

    yield* streamOpenAIResponse(
      response,
      this.config.defaultModel,
      thinkingEnabled,
    );
  }

  async listModels(): Promise<string[]> {
    return [this.config.defaultModel];
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
            model: this.config.defaultModel,
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

  /** Apply provider-specific temperature logic (clamping, etc.). */
  protected applyTemperature(
    body: OpenAIChatRequest,
    overrides?: ProviderOverrides,
  ): void {
    const temp = overrides?.temperature ?? this.config.temperature;
    if (body.temperature === undefined && temp !== undefined) {
      body.temperature = temp;
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
