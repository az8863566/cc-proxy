import type { ProviderConfig } from "../config.js";
import type { OpenAIChatRequest } from "../conversion/anthropic-to-openai.js";
import { OpenAICompatibleProvider } from "./openai-compatible.js";

/**
 * OpenCode Go provider — uses OpenAI Chat Completions API.
 *
 * Known issue: Model-level options (reasoning/thinking) may be silently
 * dropped in headless mode (GitHub issue #27361).
 */
export class OpenCodeGoProvider extends OpenAICompatibleProvider {
  readonly id = "opencode_go";

  constructor(config: ProviderConfig) {
    super(config, "OpenCode Go");
  }

  protected buildUpstreamBody(
    openaiBody: OpenAIChatRequest,
    thinkingEnabled: boolean,
    thinkingLevel: string | undefined,
  ): Record<string, unknown> {
    const body = super.buildUpstreamBody(openaiBody, thinkingEnabled, thinkingLevel);

    if (thinkingEnabled) {
      const level = thinkingLevel ?? "high";
      const effortMap: Record<string, string> = {
        off: "none",
        low: "minimal",
        high: "high",
        max: "xhigh",
      };
      body.reasoning_effort = effortMap[level] ?? "high";
    }

    return body;
  }
}
