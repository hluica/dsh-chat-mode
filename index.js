/**
 * Host half of the chat-mode bundle.
 *
 * It exists for two early, session-level duties that must happen before the
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
 * - serve the owner-only `/dsh-chat-mode/api/state` availability snapshot the
 *   Client half polls to show or hide the dynamic Wolfram tool-pack item.
 *
 * The preset-scope plugin (`./preset`) still owns the per-Agent permission
 * shadow, tool restrictions, projection, commands, and the real guidance
 * value (registered in the preset scope, which shadows this fallback). Keeping
 * this half import-free keeps the package's dependency tree empty.
 */

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

/** Whether the global registry currently holds any Wolfram MCP tool. */
function wolframAvailable(ctx) {
  try {
    return ctx.tools.definitions().some(definition => definition.name.startsWith(WOLFRAM_PREFIX));
  } catch {
    return false;
  }
}

/**
 * Serve one availability snapshot. This is deliberately an HTTP route rather
 * than a session event: an unknown event type written by a plugin cannot be
 * marked `ignorable` through `Session.append()`, and such a log would refuse
 * to reopen.
 * @param ctx - Host context carrying `connection` and `tools`.
 * @param req - Node request.
 * @param res - Node response.
 */
function serveAvailability(ctx, req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { ok: false, error: 'method not allowed' });
    return;
  }
  let pathname = '/';
  try {
    pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
  } catch {
    sendJson(res, 400, { ok: false, error: 'invalid url' });
    return;
  }
  if (pathname !== `${API_PREFIX}/state`) {
    sendJson(res, 404, { ok: false, error: 'not found' });
    return;
  }
  const admission = admitOwner(ctx, req);
  if (!admission.ok) {
    sendJson(res, admission.status, { ok: false, error: 'unauthorized' });
    return;
  }
  sendJson(res, 200, { ok: true, result: { wolfram: wolframAvailable(ctx) } });
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

/** Host row: session-level early permission pin and prompt fallback. */
export function apply(ctx) {
  // Global fallback only: the preset-scope plugin registers the real provider
  // and shadows this entry for Chat Agents. Keeping a fallback here makes the
  // persona's strict variable reference safe even when the preset half is
  // disabled, still loading, or failed.
  ctx.systemPrompt.variable(CHAT_GUIDANCE_VARIABLE, () => '');

  // Optional web dependencies: keep the permission pin and prompt fallback
  // active in a composition without a Web server, and register the
  // availability route only where the browser can reach it.
  ctx.inject(['webServer', 'connection', 'tools'], (apiCtx) => {
    apiCtx.effect(() => apiCtx.webServer.register({
      kind: 'prefix',
      path: API_PREFIX,
      handler: (req, res) => serveAvailability(apiCtx, req, res),
    }), 'chat-mode: availability api');
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
