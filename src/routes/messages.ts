import type { IncomingMessage, ServerResponse } from "node:http";
import type { Provider, AnthropicRequest, ProviderOverrides } from "../providers/base.js";
import type { Config } from "../config.js";
import { resolveModel, type ResolvedModel } from "../model-router.js";
import { errorEvent } from "../sse.js";
import { insertEgress } from "../db.js";
import { sendJson } from "../server.js";

/** Read the JSON body from an incoming HTTP request */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

export async function handleMessages(
  req: IncomingMessage,
  res: ServerResponse,
  config: Config,
  providers: Map<string, Provider>,
): Promise<void> {
  let body: string;
  try {
    body = await readBody(req);
  } catch {
    sendJson(res, 400, { error: { type: "invalid_request_error", message: "Failed to read request body" } });
    return;
  }

  let request: AnthropicRequest;
  try {
    request = JSON.parse(body) as AnthropicRequest;
  } catch {
    sendJson(res, 400, { error: { type: "invalid_request_error", message: "Invalid JSON" } });
    return;
  }

  // Validate required fields
  if (!request.model) {
    sendJson(res, 400, { error: { type: "invalid_request_error", message: "Missing 'model' field" } });
    return;
  }
  if (!request.messages || request.messages.length === 0) {
    sendJson(res, 400, { error: { type: "invalid_request_error", message: "messages cannot be empty" } });
    return;
  }

  // Resolve provider
  let resolved: ResolvedModel;
  try {
    resolved = resolveModel(request.model, config);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Route resolution failed";
    sendJson(res, 400, { error: { type: "invalid_request_error", message: msg } });
    return;
  }

  if (!providers.has(resolved.providerId)) {
    sendJson(res, 400, {
      error: {
        type: "invalid_request_error",
        message: `Provider '${resolved.providerId}' is not configured. Available: ${[...providers.keys()].join(", ")}`,
      },
    });
    return;
  }

  const provider = providers.get(resolved.providerId);
  if (!provider) {
    sendJson(res, 400, {
      error: {
        type: "invalid_request_error",
        message: `Unknown provider: ${resolved.providerId}`,
      },
    });
    return;
  }

  // Patch the model field for upstream
  const gatewayModel = request.model;
  request.model = resolved.providerModel;

  // Set up SSE response
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const ac = new AbortController();

  // Handle client disconnect
  req.on("close", () => {
    ac.abort();
  });

  const overrides: ProviderOverrides = {};
  if (resolved.temperature !== undefined) overrides.temperature = resolved.temperature;
  if (resolved.thinkingLevel !== undefined) overrides.thinkingLevel = resolved.thinkingLevel;
  const hasOverrides = overrides.temperature !== undefined || overrides.thinkingLevel !== undefined;

  const sentAt = new Date().toISOString();

  try {
    const { events, usage } = provider.streamResponse(
      request,
      ac.signal,
      hasOverrides ? overrides : undefined,
    );

    for await (const event of events) {
      if (res.writableEnded) break;
      res.write(event);
    }

    const u = await usage;
    insertEgress({
      sent_at: sentAt,
      gateway_model: gatewayModel,
      provider_model: resolved.providerModel,
      provider: resolved.providerId,
      input_tokens: u.input_tokens,
      output_tokens: u.output_tokens,
    });
  } catch (err) {
    if (!res.writableEnded) {
      const msg = err instanceof Error ? err.message : "Internal error";
      res.write(errorEvent(msg));
    }
  } finally {
    if (!res.writableEnded) {
      res.end();
    }
  }
}
