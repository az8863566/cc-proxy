import type { ProviderOverrides } from "./base.js";
import type { ProviderConfig } from "../config.js";
import type { OpenAIChatRequest } from "../conversion/anthropic-to-openai.js";
import { OpenAICompatibleProvider } from "./openai-compatible.js";

/**
 * Zhipu (智谱) GLM provider — uses OpenAI Chat Completions API.
 */
export class ZhipuProvider extends OpenAICompatibleProvider {
  readonly id = "zhipu";

  constructor(config: ProviderConfig) {
    super(config, "Zhipu");
  }

  protected applyTemperature(
    body: OpenAIChatRequest,
    overrides?: ProviderOverrides,
  ): void {
    const temp = overrides?.temperature ?? this.config.temperature;
    if (body.temperature === undefined && temp !== undefined) {
      let clamped = temp;
      if (clamped <= 0) clamped = 0.01;
      if (clamped >= 1) clamped = 0.99;
      body.temperature = clamped;
    }
  }

  protected buildUpstreamBody(
    openaiBody: OpenAIChatRequest,
    thinkingEnabled: boolean,
    thinkingLevel: string | undefined,
  ): Record<string, unknown> {
    const body = super.buildUpstreamBody(openaiBody, thinkingEnabled, thinkingLevel);

    if (thinkingEnabled) {
      body.thinking = { type: "enabled" };
      if (this.config.defaultModel === "glm-5.2") {
        const level = thinkingLevel ?? "high";
        const effortMap: Record<string, string> = {
          low: "high",
          high: "high",
          max: "max",
        };
        body.reasoning_effort = effortMap[level] ?? "high";
      }
    } else {
      body.thinking = { type: "disabled" };
    }

    return body;
  }
}
