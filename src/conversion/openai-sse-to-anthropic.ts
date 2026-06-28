/**
 * OpenAI Chat Completions SSE → Anthropic Messages SSE converter.
 *
 * Handles:
 * - reasoning_content → thinking_delta
 * - content with <think> tags → thinking_delta + text_delta
 * - tool_calls → tool_use blocks
 * - finish_reason → stop_reason mapping
 */

import {
  messageStart,
  contentBlockStart,
  contentBlockDelta,
  contentBlockStop,
  messageDelta,
  messageStop,
} from "../sse.js";

const STOP_REASON_MAP: Record<string, string> = {
  stop: "end_turn",
  length: "max_tokens",
  tool_calls: "tool_use",
  content_filter: "end_turn",
};

/** Streaming parser for <think>...</think> tags */
class ThinkTagParser {
  private buffer = "";
  private inThink = false;

  /** Feed text, return parsed chunks { type: "thinking" | "text", content: string } */
  feed(chunk: string): Array<{ type: "thinking" | "text"; content: string }> {
    this.buffer += chunk;
    const results: Array<{ type: "thinking" | "text"; content: string }> = [];

    while (this.buffer) {
      const prevLen = this.buffer.length;

      if (!this.inThink) {
        const start = this.buffer.indexOf("<think>");
        if (start === -1) {
          // Check for partial tag at end
          const lastBracket = this.buffer.lastIndexOf("<");
          if (lastBracket !== -1 && "<think>".startsWith(this.buffer.slice(lastBracket))) {
            results.push({ type: "text", content: this.buffer.slice(0, lastBracket) });
            this.buffer = this.buffer.slice(lastBracket);
            break;
          }
          results.push({ type: "text", content: this.buffer });
          this.buffer = "";
          break;
        }
        if (start > 0) {
          results.push({ type: "text", content: this.buffer.slice(0, start) });
        }
        this.buffer = this.buffer.slice(start + "<think>".length);
        this.inThink = true;
      } else {
        const end = this.buffer.indexOf("</think>");
        if (end === -1) {
          // Check partial close tag
          const lastBracket = this.buffer.lastIndexOf("<");
          if (lastBracket !== -1 && "</think>".startsWith(this.buffer.slice(lastBracket))) {
            results.push({ type: "thinking", content: this.buffer.slice(0, lastBracket) });
            this.buffer = this.buffer.slice(lastBracket);
            break;
          }
          results.push({ type: "thinking", content: this.buffer });
          this.buffer = "";
          break;
        }
        results.push({ type: "thinking", content: this.buffer.slice(0, end) });
        this.buffer = this.buffer.slice(end + "</think>".length);
        this.inThink = false;
      }

      if (this.buffer.length === prevLen) break; // prevent infinite loop
    }

    return results;
  }

  /** Flush any remaining buffered content */
  flush(): { type: "thinking" | "text"; content: string } | null {
    if (this.buffer) {
      const content = this.buffer;
      this.buffer = "";
      return { type: this.inThink ? "thinking" : "text", content };
    }
    return null;
  }
}

interface StreamState {
  messageId: string;
  model: string;
  inputTokens: number;
  blockIndex: number;
  thinkingIndex: number;
  textIndex: number;
  thinkingStarted: boolean;
  textStarted: boolean;
  toolStates: Map<number, { blockIndex: number; started: boolean; id: string; name: string }>;
  accumulatedOutput: string;
}

function createState(messageId: string, model: string, inputTokens: number): StreamState {
  return {
    messageId,
    model,
    inputTokens,
    blockIndex: 0,
    thinkingIndex: -1,
    textIndex: -1,
    thinkingStarted: false,
    textStarted: false,
    toolStates: new Map(),
    accumulatedOutput: "",
  };
}

/** Estimate output tokens from accumulated text */
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/**
 * Convert OpenAI SSE chunk to Anthropic SSE events.
 * Call for each OpenAI chunk; finalize with done().
 */
export function* convertOpenAIChunk(
  chunk: unknown,
  state: StreamState,
  thinkParser: ThinkTagParser,
  thinkingEnabled: boolean,
): Generator<string> {
  const choice = (chunk as any)?.choices?.[0];
  if (!choice) return;

  const delta = choice.delta;
  if (!delta) return;

  // Handle reasoning_content
  const reasoning = typeof delta.reasoning_content === "string" ? delta.reasoning_content : null;
  if (thinkingEnabled && reasoning) {
    if (state.thinkingIndex === -1) {
      // Close text block before opening thinking
      if (state.textStarted) {
        yield contentBlockStop(state.textIndex);
        state.textStarted = false;
      }
      state.thinkingIndex = state.blockIndex++;
      state.thinkingStarted = true;
      yield contentBlockStart(state.thinkingIndex, "thinking");
    }
    state.accumulatedOutput += reasoning;
    yield contentBlockDelta(state.thinkingIndex, "thinking_delta", { thinking: reasoning });
  }

  // Handle text content with <think> tag parsing
  if (typeof delta.content === "string" && delta.content) {
    const parts = thinkParser.feed(delta.content);
    for (const part of parts) {
      if (part.type === "thinking") {
        if (state.thinkingIndex === -1) {
          if (state.textStarted) {
            yield contentBlockStop(state.textIndex);
            state.textStarted = false;
          }
          state.thinkingIndex = state.blockIndex++;
          state.thinkingStarted = true;
          yield contentBlockStart(state.thinkingIndex, "thinking");
        }
        state.accumulatedOutput += part.content;
        yield contentBlockDelta(state.thinkingIndex, "thinking_delta", { thinking: part.content });
      } else {
        if (state.textIndex === -1) {
          if (state.thinkingStarted) {
            yield contentBlockStop(state.thinkingIndex);
            state.thinkingStarted = false;
          }
          state.textIndex = state.blockIndex++;
          state.textStarted = true;
          yield contentBlockStart(state.textIndex, "text");
        }
        state.accumulatedOutput += part.content;
        yield contentBlockDelta(state.textIndex, "text_delta", { text: part.content });
      }
    }
  }

  // Handle tool_calls
  if (delta.tool_calls) {
    // Close open content blocks before starting tool blocks
    if (state.thinkingStarted) {
      yield contentBlockStop(state.thinkingIndex);
      state.thinkingStarted = false;
    }
    if (state.textStarted) {
      yield contentBlockStop(state.textIndex);
      state.textStarted = false;
    }

    for (const tc of delta.tool_calls) {
      const idx = tc.index;
      let toolState = state.toolStates.get(idx);

      if (!toolState || !toolState.started) {
        const blockIdx = state.blockIndex++;
        toolState = {
          blockIndex: blockIdx,
          started: true,
          id: tc.id ?? "",
          name: tc.function?.name ?? "",
        };
        state.toolStates.set(idx, toolState);
        yield contentBlockStart(blockIdx, "tool_use", {
          id: toolState.id,
          name: toolState.name,
          input: {},
        });
      }

      // Update name/id from streaming fragments
      if (tc.id && toolState.id !== tc.id) toolState.id = tc.id;
      if (tc.function?.name && toolState.name !== tc.function.name) {
        toolState.name = tc.function.name;
      }

      if (tc.function?.arguments) {
        yield contentBlockDelta(toolState.blockIndex, "input_json_delta", {
          partial_json: tc.function.arguments,
        });
      }
    }
  }
}

/** Finalize the stream: flush parser, close blocks, emit message_delta and message_stop */
export function* finalizeStream(
  state: StreamState,
  thinkParser: ThinkTagParser,
  finishReason: string | undefined,
): Generator<string> {
  // Flush remaining parser content
  const remaining = thinkParser.flush();
  if (remaining) {
    if (remaining.type === "thinking") {
      if (state.thinkingIndex === -1) {
        state.thinkingIndex = state.blockIndex++;
        yield contentBlockStart(state.thinkingIndex, "thinking");
      }
      yield contentBlockDelta(state.thinkingIndex, "thinking_delta", { thinking: remaining.content });
    } else {
      if (state.textIndex === -1) {
        state.textIndex = state.blockIndex++;
        yield contentBlockStart(state.textIndex, "text");
      }
      yield contentBlockDelta(state.textIndex, "text_delta", { text: remaining.content });
    }
  }

  // Close all open blocks
  if (state.thinkingStarted) {
    yield contentBlockStop(state.thinkingIndex);
  }
  if (state.textStarted) {
    yield contentBlockStop(state.textIndex);
  }
  for (const toolState of state.toolStates.values()) {
    if (toolState.started) {
      yield contentBlockStop(toolState.blockIndex);
    }
  }

  // Ensure at least one content block (empty text if nothing emitted)
  if (state.blockIndex === 0) {
    state.textIndex = state.blockIndex++;
    yield contentBlockStart(state.textIndex, "text");
    yield contentBlockDelta(state.textIndex, "text_delta", { text: " " });
    yield contentBlockStop(state.textIndex);
  }

  const stopReason = STOP_REASON_MAP[finishReason ?? ""] ?? "end_turn";
  const outputTokens = estimateTokens(state.accumulatedOutput);
  yield messageDelta(stopReason, outputTokens, state.inputTokens);
  yield messageStop();
}

import type { Usage, StreamHandle } from "../providers/base.js";

export { createState, ThinkTagParser, messageStart };

/**
 * Read an OpenAI SSE stream from a fetch Response and convert to Anthropic SSE.
 * Captures real usage from upstream's final chunk for egress logging.
 */
export function streamOpenAIResponse(
  response: Response,
  defaultModel: string,
  thinkingEnabled: boolean,
  estimatedInputTokens: number,
): StreamHandle {
  let capturedUsage: Usage = { input_tokens: estimatedInputTokens, output_tokens: 0 };
  let resolveUsage!: (u: Usage) => void;
  const usage = new Promise<Usage>((resolve) => { resolveUsage = resolve; });

  async function* generate(): AsyncGenerator<string> {
    if (!response.body) {
      throw new Error("Upstream returned empty response body");
    }

    const msgId = `msg_${Date.now()}`;
    const state = createState(msgId, defaultModel, estimatedInputTokens);
    const thinkParser = new ThinkTagParser();

    yield messageStart(msgId, defaultModel, estimatedInputTokens);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finishReason: string | undefined;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;

          const dataStr = trimmed.slice(6);
          if (dataStr === "[DONE]") break;

          try {
            const chunk = JSON.parse(dataStr);

            const upstreamUsage = chunk?.usage;
            if (upstreamUsage && typeof upstreamUsage === "object") {
              if (typeof upstreamUsage.prompt_tokens === "number") {
                capturedUsage.input_tokens = upstreamUsage.prompt_tokens;
                state.inputTokens = upstreamUsage.prompt_tokens;
              }
              if (typeof upstreamUsage.completion_tokens === "number") {
                capturedUsage.output_tokens = upstreamUsage.completion_tokens;
              }
            }

            const reason = chunk?.choices?.[0]?.finish_reason;
            if (reason) finishReason = reason;

            for (const event of convertOpenAIChunk(
              chunk, state, thinkParser, thinkingEnabled,
            )) {
              yield event;
            }
          } catch {
            // Skip malformed SSE lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    for (const event of finalizeStream(state, thinkParser, finishReason)) {
      yield event;
    }

    if (capturedUsage.output_tokens === 0) {
      capturedUsage.output_tokens = estimateTokens(state.accumulatedOutput);
    }

    resolveUsage(capturedUsage);
  }

  return { events: generate(), usage };
}
