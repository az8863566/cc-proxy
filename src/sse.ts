/** Anthropic SSE event builder */

export function formatSSE(event: string, data: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function messageStart(
  messageId: string,
  model: string,
  inputTokens: number,
): string {
  return formatSSE("message_start", {
    type: "message_start",
    message: {
      id: messageId,
      type: "message",
      role: "assistant",
      content: [],
      model,
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: inputTokens, output_tokens: 1 },
    },
  });
}

export function contentBlockStart(
  index: number,
  blockType: string,
  extra: Record<string, unknown> = {},
): string {
  const block: Record<string, unknown> = { type: blockType, ...extra };
  return formatSSE("content_block_start", {
    type: "content_block_start",
    index,
    content_block: block,
  });
}

export function contentBlockDelta(
  index: number,
  deltaType: string,
  content: Record<string, unknown>,
): string {
  return formatSSE("content_block_delta", {
    type: "content_block_delta",
    index,
    delta: { type: deltaType, ...content },
  });
}

export function contentBlockStop(index: number): string {
  return formatSSE("content_block_stop", {
    type: "content_block_stop",
    index,
  });
}

export function messageDelta(stopReason: string, outputTokens: number, inputTokens: number): string {
  return formatSSE("message_delta", {
    type: "message_delta",
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  });
}

export function messageStop(): string {
  return formatSSE("message_stop", { type: "message_stop" });
}

export function errorEvent(message: string): string {
  return formatSSE("error", {
    type: "error",
    error: { type: "api_error", message },
  });
}
