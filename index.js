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
 * - repeat that pin when a blank session is switched to Chat.
 *
 * The preset-scope plugin (`./preset`) still owns the per-Agent permission
 * shadow, tool restrictions, projection, and commands. Keeping this half
 * import-free keeps the package's dependency tree empty.
 */

/** Stable Loader identity; equals the bundle patch id and the settings-free entry id. */
export const ENTRY_ID = 'dsh-chat-mode';

/** Cordis plugin name used by loader diagnostics. */
export const name = 'dsh-chat-mode';

/** The permission service is the only Host service this early pin needs. */
export const inject = ['permissionPresets'];

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

/** Host row: session-level early permission pin. */
export function apply(ctx) {
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
