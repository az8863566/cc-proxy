export interface AnthropicMessage {
  role: string;
  content: unknown;
  reasoning_content?: string;
}

export interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  system?: string | unknown[];
  max_tokens: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  tools?: unknown[];
  tool_choice?: unknown;
  thinking?: { type: string; budget_tokens?: number };
  metadata?: unknown;
}

export interface ProviderOverrides {
  temperature?: number;
  thinkingLevel?: string;
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
}

export interface StreamHandle {
  events: AsyncIterable<string>;
  usage: Promise<Usage>;
}

export interface Provider {
  readonly id: string;

  streamResponse(
    request: AnthropicRequest,
    signal?: AbortSignal,
    overrides?: ProviderOverrides,
  ): StreamHandle;

  listModels(): Promise<string[]>;

  checkHealth(): Promise<boolean>;
}
