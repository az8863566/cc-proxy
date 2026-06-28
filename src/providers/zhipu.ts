import type { Provider, ProviderOverrides, AnthropicRequest, Usage, StreamHandle } from "./base.js";
import type { ProviderConfig } from "../config.js";
import {
  messageStart,
  contentBlockStart,
  contentBlockDelta,
  contentBlockStop,
  messageDelta,
  messageStop,
} from "../sse.js";

/**
 * Zhipu (智谱) provider — native Anthropic Messages API passthrough.
 */
export class ZhipuProvider implements Provider {
  readonly id = "zhipu";

  constructor(private config: ProviderConfig) {}

  streamResponse(
    request: AnthropicRequest,
    signal?: AbortSignal,
    overrides?: ProviderOverrides,
  ): StreamHandle {
    let resolveUsage!: (u: Usage) => void;
    const usage = new Promise<Usage>((resolve) => { resolveUsage = resolve; });

    const self = this;
    async function* events(): AsyncGenerator<string> {
      const url = `${self.config.baseUrl}/messages`;
      const temperature = overrides?.temperature;
      const thinkingLevel = overrides?.thinkingLevel;

      const upstreamBody: Record<string, unknown> = { ...request };

      if (upstreamBody.temperature === undefined && temperature !== undefined) {
        upstreamBody.temperature = temperature;
      }

      if (thinkingLevel === "off") {
        upstreamBody.thinking = { type: "disabled" };
      } else if (thinkingLevel) {
        const effortMap: Record<string, string> = {
          low: "high",
          high: "high",
          max: "max",
        };
        upstreamBody.thinking = {
          ...(upstreamBody.thinking as Record<string, unknown> ?? {}),
          type: "enabled",
          reasoning_effort: effortMap[thinkingLevel] ?? "high",
        };
      }

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${self.config.apiKey}`,
          Accept: "text/event-stream",
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

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let raw = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          raw += decoder.decode(value, { stream: true });
        }
      } finally {
        reader.releaseLock();
      }

      let capturedUsage: Usage = { input_tokens: 0, output_tokens: 0 };

      // Try full JSON response first (non-streaming), then SSE fallback
      try {
        const json = JSON.parse(raw);
        const u = json?.usage;
        if (u) {
          capturedUsage.input_tokens = typeof u.input_tokens === "number" ? u.input_tokens : 0;
          capturedUsage.output_tokens = typeof u.output_tokens === "number" ? u.output_tokens : 0;
        }

        const msgId = json.id || `msg_${Date.now()}`;
        const model = json.model || request.model;
        yield messageStart(msgId, model, capturedUsage.input_tokens);

        let bi = 0;
        for (const block of json.content ?? []) {
          if (block.type === "thinking") {
            yield contentBlockStart(bi, "thinking");
            yield contentBlockDelta(bi, "thinking_delta", { thinking: block.thinking ?? "" });
            yield contentBlockStop(bi);
          } else if (block.type === "text") {
            yield contentBlockStart(bi, "text");
            yield contentBlockDelta(bi, "text_delta", { text: block.text ?? "" });
            yield contentBlockStop(bi);
          } else if (block.type === "tool_use") {
            yield contentBlockStart(bi, "tool_use", { id: block.id, name: block.name, input: {} });
            if (block.input) {
              yield contentBlockDelta(bi, "input_json_delta", { partial_json: JSON.stringify(block.input) });
            }
            yield contentBlockStop(bi);
          }
          bi++;
        }

        if (bi === 0) {
          yield contentBlockStart(0, "text");
          yield contentBlockDelta(0, "text_delta", { text: " " });
          yield contentBlockStop(0);
        }

        const stopReason = json.stop_reason === "end_turn" ? "end_turn"
          : json.stop_reason === "max_tokens" ? "max_tokens"
          : "end_turn";
        yield messageDelta(stopReason, capturedUsage.output_tokens, capturedUsage.input_tokens);
        yield messageStop();
      } catch {
        // Not JSON — try SSE streaming passthrough
        const lines = raw.split("\n");
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const dataStr = line.slice(6);
            try {
              const payload = JSON.parse(dataStr);
              const plUsage = payload?.message?.usage || payload?.usage;
              if (plUsage && typeof plUsage === "object") {
                if (typeof plUsage.input_tokens === "number") capturedUsage.input_tokens = plUsage.input_tokens;
                if (typeof plUsage.output_tokens === "number") capturedUsage.output_tokens = plUsage.output_tokens;
              }
            } catch { /* skip parse errors */ }
            yield `data: ${dataStr}\n\n`;
          } else if (line.startsWith("event: ")) {
            yield `${line}\n`;
          }
        }
      }

      resolveUsage(capturedUsage);
    }

    return { events: events(), usage };
  }

  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.config.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
      });
      if (!response.ok) return [];
      const json = await response.json();
      const data = json?.data as Array<{ id: string }> | undefined;
      return data?.map((m) => m.id) ?? [];
    } catch {
      return [];
    }
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
