/**
 * Host half of the chat-mode bundle.
 *
 * It exists for four early, session-level duties that must happen before the
 * first prompt resolves its tool set and before the chat preset plugin has an
 * Agent to work with:
 *
 * - pin a fresh Chat session to `read-only` as soon as the session exists, so
 *   the blank new-session screen and the first request both see the intended
 *   permission instead of the composition default `workspace-write`;
 * - repeat that pin when a blank session is switched to Chat;
 * - register an empty global fallback for the chat tool-guidance prompt
 *   variable, so a missing/disabled preset plugin can never make the strict
 *   `{{chat_tool_guidance}}` interpolation in the chat persona throw;
 * - serve the owner-only `/dsh-chat-mode/api` routes used by the composer tool
 *   menu and the “Chat Mode工具配置” settings page, and persist the custom
 *   tool-pack document in `$DSH_HOME/dsh-chat-mode/tools.json`.
 *
 * The preset-scope plugin (`./preset`) still owns the per-Agent permission
 * shadow, tool restrictions, projection, commands, and the real guidance
 * value (registered in the preset scope, which shadows this fallback). This
 * half imports only Node builtins through `./config`, so the package's
 * dependency tree stays empty.
 */

import {
  BUILTIN_TOOL_NAMES,
  appendToolPack,
  ensureConfigFile,
  errorText,
  getToolsConfig,
  toolInConfig,
  updateToolPack,
  writeToolsConfig,
} from './config.js';

/** Stable Loader identity; equals the bundle patch id and the settings-free entry id. */
export const ENTRY_ID = 'dsh-chat-mode';

/** Cordis plugin name used by loader diagnostics. */
export const name = 'dsh-chat-mode';

/** The permission service and prompt registry this early half needs. */
export const inject = ['permissionPresets', 'systemPrompt'];

/** Prompt variable consumed by the Chat persona prefix. */
const CHAT_GUIDANCE_VARIABLE = 'chat_tool_guidance';

/** Owner-only route prefix shared by the Host and Client halves. */
const API_PREFIX = '/dsh-chat-mode/api';

/** Stable model-facing namespace of the Wolfram MCP server. */
const WOLFRAM_PREFIX = 'mcp__WolframLanguage__';

/** Maximum JSON request body accepted by the settings routes. */
const MAX_BODY_BYTES = 256 * 1024;

/** Built-in names never offered by the settings page's candidate list. */
const BUILTIN_TOOL_SET = new Set(BUILTIN_TOOL_NAMES);

/**
 * Send one JSON response without throwing into the route handler.
 * @param res - Node response object.
 * @param status - HTTP status.
 * @param payload - JSON-serializable payload.
 */
function sendJson(res, status, payload) {
  try {
    res.statusCode = status;
    res.setHeader?.('Content-Type', 'application/json; charset=utf-8');
    res.setHeader?.('Cache-Control', 'no-store');
    res.end?.(JSON.stringify(payload));
  } catch {
    // A disconnected browser must not affect plugin lifecycle.
  }
}

/**
 * Admit only the owner principal for this route, matching the Web server's
 * authenticated-URL contract.
 * @param ctx - Host context carrying `connection`.
 * @param req - Node request.
 * @returns `{ ok: true }` or a rejection status.
 */
function admitOwner(ctx, req) {
  try {
    const admission = ctx.connection.admit(req);
    if (admission !== null && typeof admission === 'object' && 'rejection' in admission) {
      return { ok: false, status: admission.rejection === 401 ? 401 : 403 };
    }
    if (admission?.peer?.principal?.kind !== 'owner') return { ok: false, status: 403 };
    return { ok: true };
  } catch {
    return { ok: false, status: 401 };
  }
}

/** The current global model-facing tool names. */
function globalToolNames(ctx) {
  try {
    return ctx.tools.definitions().map((definition) => definition.name);
  } catch {
    return [];
  }
}

/** Whether the global registry currently holds any Wolfram MCP tool. */
function wolframAvailable(ctx) {
  return globalToolNames(ctx).some((name) => name.startsWith(WOLFRAM_PREFIX));
}

/** Whether one configured pack currently has at least one registered tool. */
function packAvailable(pack, names) {
  if (typeof pack.prefix === 'string' && names.some((name) => name.startsWith(pack.prefix))) return true;
  return (pack.tools ?? []).some((name) => names.includes(name));
}

/**
 * Project the configuration's packs into the Client-facing summary.
 * @param ctx - Host context carrying `tools`.
 * @param config - normalized configuration document.
 * @returns {Array<Record<string, unknown>>}
 */
function customPackSummary(ctx, config) {
  const names = globalToolNames(ctx);
  return config.tools.map((pack) => ({
    id: pack.id,
    label: pack.label,
    icon: pack.icon,
    hidden: pack.hidden === true,
    available: packAvailable(pack, names),
    ...(pack.prefix === undefined ? {} : { prefix: pack.prefix }),
    ...(Array.isArray(pack.tools) ? { tools: pack.tools } : {}),
  }));
}

/**
 * The candidate tools shown by the settings page: every registered tool that
 * is not a built-in, with a marker for tools already claimed by a pack.
 * @param ctx - Host context carrying `tools`.
 * @param config - normalized configuration document.
 * @returns {Array<{ name: string, description: string, configured: boolean }>}
 */
function candidateTools(ctx, config) {
  let definitions = [];
  try {
    definitions = ctx.tools.definitions();
  } catch {
    definitions = [];
  }
  const byName = new Map();
  for (const definition of definitions) {
    if (typeof definition?.name !== 'string' || definition.name === '') continue;
    if (BUILTIN_TOOL_SET.has(definition.name)) continue;
    byName.set(definition.name, typeof definition.description === 'string' ? definition.description : '');
  }
  return [...byName.entries()]
    .map(([name, description]) => {
      const owner = config.tools.find((pack) => toolInConfig(pack, name));
      return {
        name,
        description,
        configured: owner !== undefined,
        configuredBy: owner?.label ?? null,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * The availability snapshot consumed by the composer tool menu.
 * @param ctx - Host context carrying `tools`.
 * @returns {Record<string, unknown>}
 */
function statePayload(ctx) {
  const snapshot = getToolsConfig();
  return {
    wolfram: wolframAvailable(ctx),
    // Hidden packs are omitted from the menu; the settings page reads them
    // through `/tools` instead.
    custom: customPackSummary(ctx, snapshot.config).filter((pack) => pack.hidden !== true),
    configPath: snapshot.displayPath,
    configError: snapshot.error,
  };
}

/**
 * The full configuration snapshot consumed by the settings page.
 * @param ctx - Host context carrying `tools`.
 * @returns {Record<string, unknown>}
 */
function toolsPayload(ctx) {
  const snapshot = getToolsConfig();
  return {
    path: snapshot.displayPath,
    absolutePath: snapshot.path,
    exists: snapshot.exists,
    error: snapshot.error,
    config: snapshot.config,
    custom: customPackSummary(ctx, snapshot.config),
  };
}

/**
 * Read and parse one JSON request body.
 * @param req - Node request.
 * @returns {Promise<Record<string, unknown>>}
 */
async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error('request body exceeds 256 KiB');
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (text.trim() === '') return {};
  const parsed = JSON.parse(text);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('request body must be a JSON object');
  }
  return parsed;
}

/**
 * Serve one owner-only API request.
 * @param ctx - Host context with `connection`, `tools`, `logger`, and `emit`.
 * @param req - Node request.
 * @param res - Node response.
 */
async function serveApi(ctx, req, res) {
  let pathname = '/';
  try {
    pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
  } catch {
    sendJson(res, 400, { ok: false, error: 'invalid url' });
    return;
  }
  if (!pathname.startsWith(API_PREFIX)) {
    sendJson(res, 404, { ok: false, error: 'not found' });
    return;
  }
  const route = pathname.slice(API_PREFIX.length) || '/';
  const admission = admitOwner(ctx, req);
  if (!admission.ok) {
    sendJson(res, admission.status, { ok: false, error: 'unauthorized' });
    return;
  }

  if (route === '/state' && req.method === 'GET') {
    sendJson(res, 200, { ok: true, result: statePayload(ctx) });
    return;
  }

  if (route === '/tools' && req.method === 'GET') {
    sendJson(res, 200, { ok: true, result: toolsPayload(ctx) });
    return;
  }

  if (route === '/candidates' && req.method === 'GET') {
    const snapshot = getToolsConfig();
    sendJson(res, 200, {
      ok: true,
      result: { tools: candidateTools(ctx, snapshot.config), configError: snapshot.error },
    });
    return;
  }

  if (route === '/tools' && (req.method === 'POST' || req.method === 'PATCH')) {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
      return;
    }
    const snapshot = getToolsConfig();
    if (snapshot.error !== null) {
      sendJson(res, 409, { ok: false, error: snapshot.error });
      return;
    }
    let next;
    if (req.method === 'POST') {
      const appended = appendToolPack(snapshot.config, body);
      if (!appended.ok) {
        sendJson(res, 400, { ok: false, error: errorText(appended.errors) });
        return;
      }
      next = appended.config;
    } else {
      const updated = updateToolPack(snapshot.config, body.id, body);
      if (!updated.ok) {
        sendJson(res, updated.notFound === true ? 404 : 400, { ok: false, error: errorText(updated.errors) });
        return;
      }
      next = updated.config;
    }
    const written = writeToolsConfig(next);
    if (!written.ok) {
      sendJson(res, 500, { ok: false, error: written.error });
      return;
    }
    // Process-local notification: the preset half re-applies the resolution
    // immediately, without a Host restart or a client refresh.
    ctx.emit('chat-mode/config-changed');
    sendJson(res, 200, { ok: true, result: toolsPayload(ctx) });
    return;
  }

  const known = route === '/state' || route === '/tools' || route === '/candidates';
  sendJson(res, known ? 405 : 404, { ok: false, error: known ? 'method not allowed' : 'not found' });
}

/**
 * Pin one fresh Chat session to `read-only`. Seeded (restored/forked) sessions
 * keep their recorded choice; the preset-scope plugin also preserves an
 * allowed `workspace-write` choice there.
 * @param ctx - Host plugin context.
 * @param session - the Session whose permission should be pinned.
 * @param bySelection - true for an explicit `agent-preset/selected` switch,
 * which may carry a session header written before the switch.
 */
function pin(ctx, session, bySelection = false) {
  if (!bySelection && session.header.agentPreset !== 'chat') return;
  if (session.header.isSeeded === true) return;
  try {
    if (ctx.permissionPresets.current(session) === 'read-only') return;
    ctx.permissionPresets.set(session, 'read-only');
  } catch (error) {
    // The permissions projection may not be ready yet; the preset-scope
    // plugin's agent/created pin retries at Agent creation.
    try {
      ctx.logger?.warn?.(`chat-mode: early permission pin failed: ${error instanceof Error ? error.message : String(error)}`);
    } catch {
      // Logging must not break session creation.
    }
  }
}

/** Host row: session-level early permission pin, prompt fallback, and tools API. */
export function apply(ctx) {
  // Global fallback only: the preset-scope plugin registers the real provider
  // and shadows this entry for Chat Agents. Keeping a fallback here makes the
  // persona's strict variable reference safe even when the preset half is
  // disabled, still loading, or failed.
  ctx.systemPrompt.variable(CHAT_GUIDANCE_VARIABLE, () => '');

  // Materialize the default configuration document on first run so users can
  // inspect and edit it; failures fall back to the in-memory defaults.
  try {
    const created = ensureConfigFile();
    if (created.error !== undefined) {
      try {
        ctx.logger?.warn?.(`chat-mode: ${created.error}`);
      } catch {
        // Logging must not break activation.
      }
    }
  } catch (error) {
    try {
      ctx.logger?.warn?.(`chat-mode: cannot prepare the tool configuration: ${error instanceof Error ? error.message : String(error)}`);
    } catch {
      // Logging must not break activation.
    }
  }

  // Optional web dependencies: keep the permission pin and prompt fallback
  // active in a composition without a Web server, and register the tools API
  // only where the browser can reach it.
  ctx.inject(['webServer', 'connection', 'tools'], (apiCtx) => {
    apiCtx.effect(() => apiCtx.webServer.register({
      kind: 'prefix',
      path: API_PREFIX,
      handler: (req, res) => serveApi(apiCtx, req, res).catch((error) => {
        try {
          sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
        } catch {
          // A disconnected browser must not affect plugin lifecycle.
        }
      }),
    }), 'chat-mode: tools api');
  });

  // `session/created` dispatch keeps the Session read-only: an append made
  // synchronously by a creation listener throws. Defer one microtask so the
  // announcement has completed but the first prompt has not started.
  ctx.on('session/created', (session) => {
    queueMicrotask(() => pin(ctx, session));
  });
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'agent-preset/selected') return;
    if (event.data?.agentPreset !== 'chat') return;
    // Appending inside a session/event notification would reenter the append
    // publication; defer to the next microtask.
    queueMicrotask(() => pin(ctx, session, true));
  });
}
