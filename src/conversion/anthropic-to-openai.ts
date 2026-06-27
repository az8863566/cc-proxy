/**
 * Convert Anthropic Messages API request → OpenAI Chat Completions request body.
 *
 * Reference: free-claude-code's AnthropicToOpenAIConverter (simplified).
 */

import type { AnthropicMessage, AnthropicRequest } from "../providers/base.js";

interface AnthropicBlock {
  type: string;
  text?: string;
  thinking?: string;
  name?: string;
  id?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: unknown;
  source?: unknown;
}

interface AnthropicTool {
  name?: string;
  description?: string;
  input_schema?: Record<string, unknown>;
}

interface OpenAIMessage {
  role: string;
  content: string;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  reasoning_content?: string;
}

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface OpenAIChatRequest {
  model: string;
  messages: OpenAIMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string[];
  tools?: OpenAITool[];
  tool_choice?: unknown;
  stream: true;
}

interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** Serialize tool_result content for OpenAI "role: tool" messages */
function serializeToolResult(content: unknown): string {
  if (content === null || content === undefined) return "";
  if (typeof content === "string") return content;
  if (typeof content === "object") {
    if (Array.isArray(content)) {
      return content
        .map((item) => {
          if (typeof item === "object" && item !== null && "text" in item) {
            return String((item as Record<string, unknown>).text ?? "");
          }
          return JSON.stringify(item);
        })
        .join("\n");
    }
    return JSON.stringify(content);
  }
  return String(content);
}

/** Wrap reasoning content in think tags for replay to OpenAI providers */
function thinkTagContent(reasoning: string): string {
  return `<think>\n${reasoning}\n</think>`;
}

function convertSystemPrompt(system: unknown): OpenAIMessage | null {
  if (typeof system === "string") {
    return { role: "system", content: system };
  }
  if (Array.isArray(system)) {
    const parts = (system as AnthropicBlock[])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .filter(Boolean);
    if (parts.length > 0) {
      return { role: "system", content: parts.join("\n\n") };
    }
  }
  return null;
}

function convertAssistantMessage(
  blocks: AnthropicBlock[],
  reasoningContent: string | undefined,
): OpenAIMessage[] {
  const results: OpenAIMessage[] = [];
  const textParts: string[] = [];
  const thinkingParts: string[] = [];
  const toolCalls: OpenAIToolCall[] = [];

  for (const block of blocks) {
    switch (block.type) {
      case "text":
        textParts.push(block.text ?? "");
        break;
      case "thinking":
        thinkingParts.push(block.thinking ?? "");
        break;
      case "redacted_thinking":
        // Skip — opaque provider data, not model-visible
        break;
      case "tool_use": {
        const tc: OpenAIToolCall = {
          id: block.id ?? "",
          type: "function",
          function: {
            name: block.name ?? "",
            arguments: JSON.stringify(block.input ?? {}),
          },
        };
        toolCalls.push(tc);
        break;
      }
    }
  }

  // Build content string: thinking goes into <think> tags, then text follows
  const thinkStr = thinkingParts.length > 0
    ? thinkTagContent(thinkingParts.join("\n"))
    : "";
  const textStr = textParts.join("\n\n");
  let contentStr = [thinkStr, textStr].filter(Boolean).join("\n\n");

  // Also support reasoning_content replay (for providers that accept it)
  const reasoning = reasoningContent || (thinkingParts.length > 0 ? thinkingParts.join("\n") : undefined);

  if (!contentStr && toolCalls.length === 0) {
    contentStr = " ";
  }

  const msg: OpenAIMessage = {
    role: "assistant",
    content: contentStr,
  };

  if (toolCalls.length > 0) {
    msg.tool_calls = toolCalls;
    // OpenAI doesn't allow content with tool_calls in same message -> empty string
    if (contentStr === " " && reasoning) {
      msg.content = "";
    }
  }

  if (reasoning) {
    msg.reasoning_content = reasoning;
  }

  results.push(msg);
  return results;
}

function convertUserMessage(blocks: AnthropicBlock[]): OpenAIMessage[] {
  const results: OpenAIMessage[] = [];
  const textParts: string[] = [];

  for (const block of blocks) {
    switch (block.type) {
      case "text":
        textParts.push(block.text ?? "");
        break;
      case "tool_result": {
        // Flush pending text before the tool result
        if (textParts.length > 0) {
          results.push({ role: "user", content: textParts.join("\n") });
          textParts.length = 0;
        }
        results.push({
          role: "tool",
          content: serializeToolResult(block.content),
          tool_call_id: block.tool_use_id ?? "",
        });
        break;
      }
    }
  }

  if (textParts.length > 0) {
    results.push({ role: "user", content: textParts.join("\n") });
  }

  return results;
}

function convertTools(tools: AnthropicTool[]): OpenAITool[] {
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name ?? "",
      description: tool.description ?? "",
      parameters: tool.input_schema ?? { type: "object", properties: {} },
    },
  }));
}

/**
 * Convert Anthropic Messages request → OpenAI Chat Completions request body.
 */
export function anthropicToOpenAI(
  request: AnthropicRequest,
  options: {
    thinkingEnabled?: boolean;
    reasoningEffort?: string;
  } = {},
): OpenAIChatRequest {
  const messages: OpenAIMessage[] = [];

  // System prompt
  if (request.system) {
    const sys = convertSystemPrompt(request.system);
    if (sys) messages.push(sys);
  }

  // Convert each message
  for (const msg of request.messages) {
    const content = msg.content;

    if (typeof content === "string") {
      messages.push({ role: msg.role, content });
    } else if (Array.isArray(content)) {
      if (msg.role === "assistant") {
        messages.push(
          ...convertAssistantMessage(content as AnthropicBlock[], msg.reasoning_content),
        );
      } else if (msg.role === "user") {
        messages.push(...convertUserMessage(content as AnthropicBlock[]));
      } else {
        // Fallback: flatten to string
        messages.push({
          role: msg.role,
          content: (content as AnthropicBlock[]).map((b) => (b.type === "text" ? b.text ?? "" : "")).join(""),
        });
      }
    } else {
      messages.push({ role: msg.role, content: String(content) });
    }
  }

  const body: OpenAIChatRequest = {
    model: request.model,
    messages,
    max_tokens: request.max_tokens,
    stream: true,
  };

  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (request.top_p !== undefined) body.top_p = request.top_p;
  if (Array.isArray(request.stop_sequences) && request.stop_sequences.length) {
    body.stop = request.stop_sequences;
  }
  if (Array.isArray(request.tools) && request.tools.length) {
    body.tools = convertTools(request.tools as AnthropicTool[]);
  }
  if (request.tool_choice !== undefined) {
    body.tool_choice = request.tool_choice;
  }

  return body;
}
