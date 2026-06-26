import type { Provider, ProviderOverrides, AnthropicRequest } from "./base.js";
import type { ProviderConfig } from "../config.js";

/**
 * DeepSeek provider — native Anthropic Messages API passthrough.
 */
export class DeepSeekProvider implements Provider {
  readonly id = "deepseek";

  constructor(private config: ProviderConfig) {}

  async *streamResponse(
    request: AnthropicRequest,
    signal?: AbortSignal,
    overrides?: ProviderOverrides,
  ): AsyncIterable<string> {
    const url = `${this.config.baseUrl}/messages`;
    const temperature = overrides?.temperature ?? this.config.temperature;
    const thinkingLevel = overrides?.thinkingLevel ?? this.config.thinkingLevel;

    const upstreamBody: Record<string, unknown> = {
      ...request,
      model: this.config.defaultModel,
    };

    if (upstreamBody.temperature === undefined && temperature !== undefined) {
      upstreamBody.temperature = temperature;
    }

    if (thinkingLevel === "off") {
      upstreamBody.thinking = { type: "disabled" };
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
        Accept: "text/event-stream",
      },
      body: JSON.stringify(upstreamBody),
      signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `DeepSeek upstream error ${response.status}: ${text.slice(0, 500)}`,
      );
    }

    if (!response.body) {
      throw new Error("DeepSeek returned empty response body");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Yield complete SSE lines (DeepSeek returns Anthropic SSE directly)
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        let event = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            event = line.slice(7);
          } else if (line.startsWith("data: ")) {
            yield `event: ${event}\ndata: ${line.slice(6)}\n\n`;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async listModels(): Promise<string[]> {
    return [this.config.defaultModel];
  }

  async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.baseUrl}/models`, {
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
        },
      });
      return response.ok || response.status === 401;
    } catch {
      return false;
    }
  }
}
