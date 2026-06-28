import type { IncomingMessage, ServerResponse } from "node:http";
import type { Provider } from "../providers/base.js";
import type { Config } from "../config.js";
import { resolveModel } from "../model-router.js";
import { sendJson } from "../server.js";

export async function handleModels(
  _req: IncomingMessage,
  res: ServerResponse,
  config: Config,
  providers: Map<string, Provider>,
): Promise<void> {
  const allModels: { id: string; object: string; created: number; display_name?: string; context_window?: number }[] = [];
  const created = Math.floor(Date.now() / 1000);

  // List per-provider models with official prefixes
  for (const [providerId, provider] of providers) {
    try {
      const models = await provider.listModels();
      for (const model of models) {
        allModels.push({
          id: `${providerId}/${model}`,
          object: "model",
          created,
          context_window: 1_000_000,
        });
      }
    } catch {
      // Skip providers that fail to list models
    }
  }

  // Claude tier aliases → show what they resolve to (skip if route not configured)
  const tiers = [
    { id: "claude-opus-4-8[1m]", lookup: "opus" },
    { id: "claude-sonnet-4-6[1m]", lookup: "sonnet" },
    { id: "claude-haiku-4-5[1m]", lookup: "haiku" },
  ];
  for (const { id, lookup } of tiers) {
    try {
      const resolved = resolveModel(lookup, config);
      if (providers.has(resolved.providerId)) {
        allModels.push({
          id,
          object: "model",
          created,
          display_name: `${resolved.providerId}/${resolved.providerModel}`,
          context_window: 1_000_000,
        });
      }
    } catch {
      // Skip tiers with no route configured
    }
  }

  sendJson(res, 200, { data: allModels, object: "list" });
}
