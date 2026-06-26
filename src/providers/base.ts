export interface AnthropicMessage {
  role: string;
  content: unknown;
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

export interface Provider {
  readonly id: string;

  /** Stream an Anthropic SSE response from this provider */
  streamResponse(
    request: AnthropicRequest,
    signal?: AbortSignal,
    overrides?: ProviderOverrides,
  ): AsyncIterable<string>;

  /** List available model IDs */
  listModels(): Promise<string[]>;

  /** Check provider health */
  checkHealth(): Promise<boolean>;
}
