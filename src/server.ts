import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Config } from "./config.js";
import type { Provider } from "./providers/base.js";
import { handleHealth } from "./routes/health.js";
import { handleModels } from "./routes/models.js";
import { handleMessages } from "./routes/messages.js";

type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  config: Config,
  providers: Map<string, Provider>,
) => void | Promise<void>;

/** Shared JSON response helper — used by routes for consistency. */
export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function checkAuth(req: IncomingMessage, config: Config): boolean {
  if (!config.authToken) return true;

  const authHeader = req.headers["authorization"] ?? "";
  const apiKey = req.headers["x-api-key"] as string | undefined;

  if (authHeader.startsWith("Bearer ")) {
    return timingSafeEqual(authHeader.slice(7), config.authToken);
  }
  if (apiKey) {
    return timingSafeEqual(apiKey, config.authToken);
  }
  return false;
}

/** Constant-time string comparison */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Route registry: "METHOD /path" → handler */
const routes = new Map<string, RouteHandler>([
  ["GET /health", handleHealth],
  ["GET /v1/models", handleModels],
  ["POST /v1/messages", handleMessages],
]);

/** Count tokens — returns a simple estimate (needed by Claude Code). */
const handleCountTokens: RouteHandler = (_req, res) => {
  sendJson(res, 200, { input_tokens: 0 });
};
routes.set("POST /v1/messages/count_tokens", handleCountTokens);

export function createApp(
  config: Config,
  providers: Map<string, Provider>,
) {
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const { method, url } = req;
    const path = url?.split("?")[0] ?? "/";

    // CORS preflight
    if (method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, x-api-key, Content-Type",
      });
      res.end();
      return;
    }

    // Auth check (skip for health)
    if (path !== "/health" && !checkAuth(req, config)) {
      sendJson(res, 401, {
        error: { type: "authentication_error", message: "Invalid API key" },
      });
      return;
    }

    // Route dispatch
    const routeKey = `${method} ${path}`;
    const handler = routes.get(routeKey);
    if (handler) {
      return handler(req, res, config, providers);
    }

    // 404
    sendJson(res, 404, {
      error: { type: "not_found", message: `Not found: ${method} ${path}` },
    });
  });
}
