/**
 * Host half of the chat-mode bundle.
 *
 * The bundle exists for its `@deepseek-ai/dsh-agent-preset` declaration and its
 * browser half. The Host row is deliberately empty: the chat projection,
 * permission lock, command shadow, and tool restrictions live in the preset
 * scope plugin (`./preset`), which is mounted only for sessions that select
 * the `chat` preset.
 *
 * Keeping this half import-free also keeps the plugin's dependency tree empty
 * and means Host activation cannot fail on a missing package.
 */

/** Stable Loader identity; equals the bundle patch id and the settings-free entry id. */
export const ENTRY_ID = 'dsh-chat-mode';

/** Cordis plugin name used by loader diagnostics. */
export const name = 'dsh-chat-mode';

/** Host row: nothing to mount globally. */
export function apply() {}
