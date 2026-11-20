/**
 * Preset-scope half of chat mode.
 *
 * Mounted only by sessions that select the `chat` Agent preset. It owns:
 *
 * - the `chatMode` session projection (`{ shell, webSearch, custom }`), folded
 *   from the known `command/run` + `command/done` events of the preset-scoped
 *   `/chat-tools` command, so resume and fork keep the user's choice without
 *   writing any plugin-defined event type;
 * - the two **built-in** gates (persistent shell and web search) plus every
 *   custom pack read from `config.js` (the Wolfram pack and any pack added in
 *   the Chat Mode tool settings), sharing one discovery / availability /
 *   restriction / prompt-guidance path;
 * - the initial permission lock: a fresh chat session is pinned to `read-only`,
 *   and a resumed/cleared/compacted session keeps only `read-only` or
 *   `workspace-write`;
 * - an Agent-scoped `/permission` command that shadows the global one and
 *   refuses `danger-full-access`;
 * - the preset-scoped `/chat-tools` command that toggles the packs;
 * - `tools.restrict()` masks that hide disabled packs from the model, plus a
 *   `tools/pre-execute` guard for batches resolved before a toggle;
 * - the `chat_tool_guidance` prompt variable consumed by the persona prefix.
 *
 * Custom packs are owned by `$DSH_HOME/dsh-chat-mode/tools.json`; the Host
 * half writes that file and emits `chat-mode/config-changed`, which re-applies
 * every known Agent's restriction immediately. No session event is appended,
 * because `Session.append()` cannot mark an unknown type `ignorable` and such a
 * log would refuse to reopen.
 *
 * The plugin imports only the local `config.js` module, which itself uses Node
 * builtins; the package keeps its empty dependency tree.
 */

import {
  WOLFRAM_PACK_ID,
  getToolsConfig,
  invalidateConfigCache,
} from './config.js';

/** Cordis plugin name used by loader diagnostics. */
export const name = 'chat-mode-preset';

/** Services required before the plugin body runs. */
export const inject = ['sessionProjections', 'permissionPresets', 'agents', 'systemPrompt', 'tools'];

/** Known event written when a human or model invokes a slash command. */
const COMMAND_RUN_EVENT = 'command/run';

/** Known event written when that slash command settles. */
const COMMAND_DONE_EVENT = 'command/done';

/** The preset-scoped command whose successful runs encode the tool choice. */
const CHAT_TOOLS_COMMAND = 'chat-tools';

/** Projection key published to the browser half. */
const CHAT_MODE_PROJECTION = 'chatMode';

/** Prompt variable referenced by the chat persona prefix. */
const CHAT_GUIDANCE_VARIABLE = 'chat_tool_guidance';

/**
 * The two built-in packs. They are fixed in code and never appear in the
 * configuration file; the settings page cannot control them.
 */
const BUILTIN_PACKS = [
  {
    kind: 'builtin',
    id: 'shell',
    stateKey: 'shell',
    names: () => [shellToolName()],
    denyReason: 'The shell tool is disabled in chat mode. Ask the user to enable “持久终端” from the Tools menu (“工具”) in the composer before running commands.',
  },
  {
    kind: 'builtin',
    id: 'search',
    stateKey: 'webSearch',
    names: () => ['web_search'],
    denyReason: 'web_search is disabled in chat mode. Ask the user to enable “联网搜索” from the Tools menu (“工具”) in the composer before searching.',
  },
];

/** The two permission presets a chat session may use. */
const ALLOWED_PERMISSIONS = new Set(['read-only', 'workspace-write']);

/** Activation flags off, no custom pack selected, and no command pending. */
const DEFAULT_STATE = Object.freeze({
  shell: false,
  webSearch: false,
  custom: Object.freeze({}),
  pending: Object.freeze({}),
});

/** Validate and normalize the pending `/chat-tools` command map. */
function normalizePending(value) {
  if (value === undefined) return {};
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('chat-mode: expected a pending command object');
  }
  const pending = {};
  for (const [commandId, args] of Object.entries(value)) {
    if (commandId === '' || typeof args !== 'string') {
      throw new Error('chat-mode: expected pending command ids mapped to argument strings');
    }
    pending[commandId] = args;
  }
  return pending;
}

/** Validate and normalize the custom pack selection map. */
function parseCustom(value) {
  if (value === undefined) return {};
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('chat-mode: expected custom to be an object');
  }
  const custom = {};
  for (const [id, flag] of Object.entries(value)) {
    if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/u.test(id)) {
      throw new Error('chat-mode: invalid custom pack id');
    }
    if (typeof flag !== 'boolean') {
      throw new Error(`chat-mode: expected custom.${id} to be a boolean`);
    }
    custom[id] = flag;
  }
  return custom;
}

/**
 * Runtime schema for the projection.
 *
 * `stateVersion` is 3 because the old top-level `wolfram` flag moved into the
 * `custom` map when Wolfram became a configuration pack. A version-2
 * checkpoint is discarded and the log replays; the parser still accepts the
 * old shape so a non-standard caller cannot corrupt the state.
 */
function parseState(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('chat-mode: expected a state object');
  }
  const shell = value.shell === undefined ? false : value.shell;
  const webSearch = value.webSearch === undefined ? false : value.webSearch;
  if (typeof shell !== 'boolean') throw new Error('chat-mode: expected shell to be a boolean');
  if (typeof webSearch !== 'boolean') throw new Error('chat-mode: expected webSearch to be a boolean');
  let custom = parseCustom(value.custom);
  if (value.wolfram === true) {
    custom = { ...custom, [WOLFRAM_PACK_ID]: true };
  }
  return { shell, webSearch, custom, pending: normalizePending(value.pending) };
}

const stateSchema = { parse: parseState };

/** Wire schema: the Client only needs the two built-ins and the custom map. */
const wireSchema = {
  parse(value) {
    const state = parseState(value);
    return { shell: state.shell, webSearch: state.webSearch, custom: state.custom };
  },
};

/** The platform's persistent shell tool name. */
function shellToolName() {
  return process.platform === 'win32' ? 'pwsh' : 'bash';
}

/** Build one state object without carrying the pending map. */
function makeState(shell, webSearch, custom) {
  return { shell, webSearch, custom };
}

/** Whether one pack is currently active for a state. Hidden packs are off. */
function packEnabled(pack, state) {
  if (pack.kind === 'builtin') return state[pack.stateKey] === true;
  return pack.hidden !== true && state.custom?.[pack.id] === true;
}

/** The pack that owns one model-facing tool name, if any. */
function packForTool(toolName, packs) {
  for (const pack of packs) {
    if (pack.kind === 'builtin') {
      if (pack.names !== undefined && pack.names().includes(toolName)) return pack;
    } else {
      if (pack.prefix !== undefined && toolName.startsWith(pack.prefix)) return pack;
      if (Array.isArray(pack.tools) && pack.tools.includes(toolName)) return pack;
    }
  }
  return undefined;
}

/** Whether one tool call is currently gated by the chat-mode state. */
function isGated(toolName, state, packs) {
  const pack = packForTool(toolName, packs);
  return pack !== undefined && !packEnabled(pack, state);
}

/** Model-facing denial text for a disabled gated tool. */
function gateReason(toolName, packs) {
  const pack = packForTool(toolName, packs);
  if (pack === undefined) return `The tool "${toolName}" is disabled in chat mode.`;
  if (pack.kind === 'builtin') return pack.denyReason;
  return `The tools of “${pack.label}” are disabled or hidden in chat mode. Ask the user to enable or show “${pack.label}” in the Chat Tools settings or the Tools menu (“工具”) before using them.`;
}

/** Whether two custom maps select the same packs. */
function sameCustom(left, right) {
  const keys = new Set([...Object.keys(left ?? {}), ...Object.keys(right ?? {})]);
  for (const key of keys) {
    if ((left?.[key] === true) !== (right?.[key] === true)) return false;
  }
  return true;
}

/** Parse the `/chat-tools` argument grammar into the next state, or an error string. */
function parseToolsCommand(rawInput, current) {
  const parts = rawInput.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { kind: 'report' };
  if (parts[0] === 'mode' && parts.length === 2) {
    switch (parts[1]) {
      case 'off': return { kind: 'state', state: makeState(false, false, {}) };
      case 'shell': return { kind: 'state', state: makeState(true, false, {}) };
      case 'search': return { kind: 'state', state: makeState(false, true, {}) };
      case 'both': return { kind: 'state', state: makeState(true, true, {}) };
      case 'wolfram': return { kind: 'state', state: makeState(false, false, { [WOLFRAM_PACK_ID]: true }) };
      case 'all': return { kind: 'state', state: makeState(true, true, { [WOLFRAM_PACK_ID]: true }) };
      default: return { kind: 'error', text: 'expected one of: off, shell, search, both, wolfram, all' };
    }
  }
  const target = parts[0];
  if (parts.length === 2) {
    if (parts[1] !== 'on' && parts[1] !== 'off') return { kind: 'error', text: 'expected on or off' };
    const enabled = parts[1] === 'on';
    if (target === 'shell' || target === 'search') {
      const state = makeState(current.shell === true, current.webSearch === true, { ...current.custom });
      if (target === 'shell') state.shell = enabled;
      else state.webSearch = enabled;
      return { kind: 'state', state };
    }
    if (/^[a-z0-9][a-z0-9-]*$/u.test(target)) {
      const custom = { ...current.custom, [target]: enabled };
      return { kind: 'state', state: makeState(current.shell === true, current.webSearch === true, custom) };
    }
    return { kind: 'error', text: 'unknown tool pack id' };
  }
  return {
    kind: 'error',
    text: 'usage: /chat-tools [mode off|shell|search|both|wolfram|all] [shell on|off] [search on|off] [<pack-id> on|off]',
  };
}

/** Human-readable activation summary for command results. */
function describeState(state, packs, availability) {
  const parts = [
    `shell=${state.shell === true ? 'on' : 'off'}`,
    `web_search=${state.webSearch === true ? 'on' : 'off'}`,
  ];
  for (const pack of packs) {
    if (pack.kind !== 'custom') continue;
    if (pack.hidden === true) {
      parts.push(`${pack.id}=hidden`);
      continue;
    }
    const available = availability[pack.id] === true;
    const enabled = state.custom?.[pack.id] === true;
    parts.push(`${pack.id}=${available ? (enabled ? 'on' : 'off') : 'unavailable'}`);
  }
  return parts.join(', ');
}

/**
 * Chat-mode preset plugin body.
 * @param ctx - preset-scope Cordis context (the preset revision is shared by
 * every session selecting `chat`).
 */
export async function apply(ctx) {
  const warn = (message) => {
    try {
      ctx.logger?.warn?.(message);
    } catch {
      // Logging must never break a tool call or agent creation.
    }
  };

  /** The live model-facing tools from the global registry. */
  const globalToolNames = () => {
    try {
      return ctx.tools.definitions().map((definition) => definition.name);
    } catch {
      return [];
    }
  };

  /** The custom packs from the current configuration file. */
  const customPacks = () => {
    const { config } = getToolsConfig();
    return config.tools.map((pack) => ({ ...pack, kind: 'custom' }));
  };

  /** The built-in packs plus the current custom packs. */
  const allPacks = () => [...BUILTIN_PACKS, ...customPacks()];

  /** Whether one custom pack currently has at least one registered tool. */
  const packAvailable = (pack) => {
    if (pack.kind === 'builtin') return true;
    const names = globalToolNames();
    if (typeof pack.prefix === 'string' && names.some((name) => name.startsWith(pack.prefix))) return true;
    return (pack.tools ?? []).some((name) => names.includes(name));
  };

  /** The availability snapshot for every pack. */
  const availabilityOf = (packs) => {
    const availability = {};
    for (const pack of packs) availability[pack.id] = packAvailable(pack);
    return availability;
  };

  // Per-session restriction bookkeeping; strong refs, cleaned up with the preset
  // revision so a chat→other→chat switch cannot leak or duplicate a mask.
  const agents = new Map();
  ctx.effect(() => () => {
    // Clear the registry before disposing so the synchronous `tools/change`
    // emitted by each lift cannot re-enter and re-install a mask while the
    // preset is unloading.
    const entries = [...agents.values()];
    agents.clear();
    for (const entry of entries) {
      if (entry.dispose === undefined) continue;
      try {
        entry.dispose();
      } catch {
        // The Agent scope may already have disposed it.
      }
    }
  }, 'chat-mode: preset restrictions cleanup');

  const projection = await ctx.sessionProjections.register({
    key: CHAT_MODE_PROJECTION,
    // v3: Wolfram moved from a dedicated flag into the config-pack map.
    stateVersion: 3,
    stateSchema,
    init: () => ({ ...DEFAULT_STATE, pending: {} }),
    apply: (state, event) => {
      // The user-visible choice is encoded by the preset-scoped
      // /chat-tools command, which is logged as known command events. This
      // avoids writing an unknown session event type, which cannot carry the
      // `ignorable` marker through Session.append() and would make the log
      // refuse to reopen.
      if (event.type === COMMAND_RUN_EVENT) {
        if (event.data?.name !== CHAT_TOOLS_COMMAND) return state;
        const commandId = event.data?.commandId;
        const args = event.data?.args;
        if (typeof commandId !== 'string' || commandId === '' || typeof args !== 'string') return state;
        if (state.pending[commandId] === args) return state;
        return { ...state, pending: { ...state.pending, [commandId]: args } };
      }
      if (event.type === COMMAND_DONE_EVENT) {
        const commandId = event.data?.commandId;
        if (typeof commandId !== 'string' || state.pending[commandId] === undefined) return state;
        const pending = { ...state.pending };
        const args = pending[commandId];
        delete pending[commandId];
        if (event.data?.kind !== 'success') return { ...state, pending };
        const parsed = parseToolsCommand(args, state);
        if (parsed.kind !== 'state') return { ...state, pending };
        return {
          shell: parsed.state.shell,
          webSearch: parsed.state.webSearch,
          custom: parsed.state.custom,
          pending,
        };
      }
      return state;
    },
    wire: {
      viewSchema: wireSchema,
      view: (state) => ({
        shell: state.shell,
        webSearch: state.webSearch,
        custom: state.custom,
      }),
    },
  });

  /** The activation flags folded from the session's command events. */
  const stateOf = (session) => {
    try {
      const state = projection.stateOf(session);
      return {
        shell: state.shell === true,
        webSearch: state.webSearch === true,
        custom: state.custom !== null && typeof state.custom === 'object' ? { ...state.custom } : {},
      };
    } catch {
      return { shell: false, webSearch: false, custom: {} };
    }
  };

  /**
   * Discover one pack's model-facing tool names for an Agent.
   *
   * Built-in (`names`) packs read the Agent view and cache the successful first
   * discovery, because our own restriction would otherwise make a disabled
   * pack look absent. Custom packs read the **global** registry: a disabled
   * pack must still be denied, and a hidden pack must stay denied even when a
   * session had previously enabled it.
   */
  const packToolNames = (agent, entry, pack) => {
    if (pack.kind === 'custom') {
      const names = globalToolNames();
      const matched = new Set();
      if (pack.prefix !== undefined) {
        for (const name of names) if (name.startsWith(pack.prefix)) matched.add(name);
      }
      if (Array.isArray(pack.tools)) {
        for (const name of pack.tools) if (names.includes(name)) matched.add(name);
      }
      return [...matched];
    }
    const cached = entry?.known?.[pack.id];
    if (cached !== undefined && cached.length > 0) return cached;
    const names = (pack.names?.() ?? []).filter((name) => {
      try {
        return agent.ctx.tools.get(name, agent) !== undefined;
      } catch {
        return false;
      }
    });
    if (entry !== undefined) entry.known[pack.id] = names;
    return names;
  };

  // The prompt variable is scoped to this preset revision; the Host half
  // registers a global `''` fallback so a missing preset cannot break strict
  // `{{chat_tool_guidance}}` interpolation.
  ctx.systemPrompt.variable(CHAT_GUIDANCE_VARIABLE, (context) => {
    const agent = context?.agent;
    if (agent === undefined) return '';
    let state;
    try {
      state = stateOf(agent.session);
    } catch {
      return '';
    }
    const texts = [];
    for (const pack of allPacks()) {
      if (pack.kind !== 'custom') continue;
      if (typeof pack.guidance !== 'string' || pack.guidance === '') continue;
      if (!packEnabled(pack, state)) continue;
      if (!packAvailable(pack)) continue;
      texts.push(pack.guidance);
    }
    return texts.join('\n\n');
  });

  /** Forget a Session that switched away from Chat. */
  const clearSession = (session) => {
    const entry = agents.get(session);
    if (entry === undefined) return;
    // Remove the registry entry before lifting its mask: the lift emits a
    // synchronous `tools/change`, and a listener that still saw the entry
    // would re-install the restriction it is trying to remove.
    agents.delete(session);
    if (entry.dispose !== undefined) {
      try {
        entry.dispose();
      } catch {
        // The Agent scope may already have disposed it.
      }
    }
  };

  /**
   * Apply the model-visible restriction for one Agent. The restriction is
   * registered on the Agent scope, where it masks inherited preset tools; the
   * preset's own scope stays untouched, so other chat sessions are unaffected.
   */
  const applyRestrictions = (agent, state) => {
    const session = agent.session;
    let entry = agents.get(session);
    if (entry === undefined) {
      entry = { agent, known: {}, dispose: undefined, key: '', busy: false };
      agents.set(session, entry);
    } else {
      entry.agent = agent;
      // Our own restrict()/lift emits a synchronous `tools/change`; while this
      // call is publishing a new key, a re-entrant reapply would read the old
      // projection state and install a stale mask. The only registry change
      // possible during this synchronous window is ours, so skip it.
      if (entry.busy === true) return;
    }
    entry.busy = true;
    try {
      const deny = [];
      const seen = new Set();
      for (const pack of allPacks()) {
        if (packEnabled(pack, state)) continue;
        for (const name of packToolNames(agent, entry, pack)) {
          if (seen.has(name)) continue;
          seen.add(name);
          deny.push(name);
        }
      }
      const key = deny.join(',');
      if (key === entry.key) return;
      // Publish the new key before touching the old restriction. Lifting it
      // emits a synchronous `tools/change`, and a listener that still saw the
      // old key would install a second, untracked mask.
      const previous = entry.dispose;
      entry.dispose = undefined;
      entry.key = key;
      if (previous !== undefined) {
        try {
          previous();
        } catch {
          // The restriction may already be gone with the agent scope.
        }
      }
      if (deny.length === 0) return;
      try {
        entry.dispose = agent.ctx.tools.restrict({ deny });
      } catch (error) {
        warn(`chat-mode: failed to restrict ${deny.join(', ')}: ${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      entry.busy = false;
    }
  };

  /**
   * Lock a session's permission. Fresh sessions (`source === 'startup'`) start
   * at read-only; a resumed/cleared/compacted session keeps an allowed choice
   * and is corrected to read-only when it carries anything wider.
   */
  const pinPermission = (session, source) => {
    let current = 'custom';
    try {
      current = ctx.permissionPresets.current(session);
    } catch (error) {
      warn(`chat-mode: cannot read current permission: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (source !== 'startup' && ALLOWED_PERMISSIONS.has(current)) return;
    if (current === 'read-only') return;
    try {
      ctx.permissionPresets.set(session, 'read-only');
    } catch (error) {
      warn(`chat-mode: failed to pin read-only: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  /**
   * Apply the initial state and permission lock for one Agent. The `/permission`
   * command lives in the preset scope (registered once alongside `/chat-tools`)
   * so a chat→other→chat switch cannot duplicate an Agent-scoped command.
   */
  const initializeAgent = (agent, source) => {
    applyRestrictions(agent, stateOf(agent.session));
    pinPermission(agent.session, source);
  };

  ctx.on('agent/created', ({ agent, source }) => {
    try {
      initializeAgent(agent, source);
    } catch (error) {
      // A failed chat-mode setup must not reject Agent creation; the permission
      // and restriction state simply stays at the composition defaults.
      warn(`chat-mode: initialization failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, { prepend: true });

  // A blank/live session can be switched to Chat after its Agent already
  // exists. `agent/created` will not fire again, so apply the restriction from
  // the selection event itself. The Agent scope is already live; this runs
  // before the next `tools.resolve()` and fixes the first turn after a switch.
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'agent-preset/selected') return;
    if (event.data?.agentPreset !== 'chat') {
      // Switching away must not leave a later `tools/change` replaying the
      // Chat restriction onto another preset's Agent.
      clearSession(session);
      return;
    }
    const agent = ctx.agents.get(session.id);
    if (agent === undefined) return;
    try {
      applyRestrictions(agent, stateOf(session));
    } catch (error) {
      warn(`chat-mode: preset switch restriction failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  // The session header's `agentPreset` is immutable creation metadata and does
  // not follow a later switch. The registry re-emits every committed selection
  // as a global `agent-preset/selected`, which is the reliable "switched away"
  // signal: drop the entry so `tools/change` cannot replay Chat's mask onto the
  // Agent while it lives under the next preset.
  ctx.on('agent-preset/selected', (sessionId, agentPreset) => {
    if (agentPreset === 'chat') return;
    const agent = ctx.agents.get(sessionId);
    if (agent !== undefined) clearSession(agent.session);
  });

  ctx.on('agent/pre-step', async ({ agent }, next) => {
    // Fallback for a composition where the creation event did not reach the
    // preset scope: apply restrictions and the permission lock before the step
    // is prepared. The normal path is `agent/created`.
    if (!agents.has(agent.session)) {
      try {
        initializeAgent(agent, undefined);
      } catch (error) {
        warn(`chat-mode: lazy initialization failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      // Keep the registry restriction fresh. Note the loop resolves the tool
      // set before this waterfall, so this only affects later steps.
      try {
        applyRestrictions(agent, stateOf(agent.session));
      } catch (error) {
        warn(`chat-mode: pre-step restriction failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return next();
  });

  // A tool registration can land after `agent/created` (or a preset reload can
  // replace the tool set). Re-apply the current per-Agent mask whenever the
  // registry changes; `applyRestrictions` deduplicates by its key, so the
  // `tools/change` emitted by our own restrict() terminates immediately.
  // Dynamic packs (Wolfram MCP and custom packs) appear and disappear here; the
  // Client half polls the Host state route to update the menu.
  ctx.on('tools/change', () => {
    for (const [session, entry] of agents) {
      try {
        applyRestrictions(entry.agent, stateOf(session));
      } catch (error) {
        warn(`chat-mode: tools/change restriction failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  });

  // The Host settings page writes the configuration file and emits this
  // process-local event. Re-read the file and apply the new deny list to every
  // known Agent immediately; the prompt provider reads the same cache on the
  // next assembly.
  ctx.on('chat-mode/config-changed', () => {
    invalidateConfigCache();
    for (const [session, entry] of agents) {
      try {
        applyRestrictions(entry.agent, stateOf(session));
      } catch (error) {
        warn(`chat-mode: config change restriction failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  });

  // Defense in depth: a batch resolved before a restriction change can still
  // carry a now-disabled tool. The guard turns that call into a clear denial.
  ctx.on('tools/pre-execute', async (exec, next) => {
    if (exec.agent === undefined) return next();
    const packs = allPacks();
    if (!isGated(exec.name, stateOf(exec.agent.session), packs)) return next();
    return { kind: 'deny', reason: gateReason(exec.name, packs) };
  });

  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.commands.register({
      name: 'chat-tools',
      description: 'Enable or disable advanced tools in chat mode',
      input: { hint: '[mode off|shell|search|both|wolfram|all] [shell on|off] [search on|off] [<pack-id> on|off]' },
      handler: ({ agent, rawInput }) => {
        const current = stateOf(agent.session);
        const packs = allPacks();
        const availability = availabilityOf(packs);
        const parsed = parseToolsCommand(rawInput, current);
        if (parsed.kind === 'error') return { kind: 'error', text: parsed.text };
        if (parsed.kind === 'report') {
          return { kind: 'success', text: `chat tools: ${describeState(current, packs, availability)}` };
        }
        const next = parsed.state;
        const parts = rawInput.trim().split(/\s+/).filter(Boolean);
        const mode = parts[0] === 'mode' ? parts[1] : undefined;
        const targetId = mode === 'all' || mode === 'wolfram'
          ? WOLFRAM_PACK_ID
          : mode === undefined && parts[0] !== 'shell' && parts[0] !== 'search'
            ? parts[0]
            : undefined;
        if (targetId !== undefined) {
          const target = packs.find((pack) => pack.kind === 'custom' && pack.id === targetId);
          if (target === undefined) {
            return { kind: 'error', text: `Unknown tool pack "${targetId}".` };
          }
          if (target.hidden === true) {
            return { kind: 'error', text: `The tool pack "${target.label}" is hidden. Show it in Settings → Chat Mode工具配置 first.` };
          }
          const enabling = mode === 'all' || mode === 'wolfram' || parts[1] === 'on';
          if (enabling && availability[targetId] !== true) {
            return { kind: 'error', text: `The tools of "${target.label}" are not available in this session.` };
          }
        }
        if (next.shell === current.shell
          && next.webSearch === current.webSearch
          && sameCustom(next.custom, current.custom)) {
          return { kind: 'success', text: `chat tools unchanged: ${describeState(next, packs, availability)}` };
        }
        // Apply immediately. The durable choice is the command/run +
        // command/done pair the command runner logs for this invocation; the
        // projection folds it back on resume and fork.
        applyRestrictions(agent, next);
        return { kind: 'success', text: `chat tools: ${describeState(next, packs, availability)}` };
      },
    });

    // Preset-scope `/permission` shadow: available to every Chat Agent, and
    // disposed/re-registered with the preset revision instead of accumulating
    // Agent-scoped command registrations across a chat→other→chat switch.
    commandCtx.commands.register({
      name: 'permission',
      description: 'Switch the permission preset (chat mode allows read-only or workspace-write only)',
      input: { hint: 'read-only|workspace-write' },
      handler: ({ agent: receiving, rawInput }) => {
        const name = rawInput.trim();
        if (name === '') {
          let current = 'unknown';
          try {
            current = ctx.permissionPresets.current(receiving.session);
          } catch {
            // Report the fallback value.
          }
          return {
            kind: 'success',
            text: `current preset ${current} (available: read-only, workspace-write)`,
          };
        }
        if (name !== 'read-only' && name !== 'workspace-write') {
          return {
            kind: 'error',
            text: `Chat mode only allows read-only or workspace-write; "${name}" is unavailable.`,
          };
        }
        try {
          ctx.permissionPresets.set(receiving.session, name);
        } catch (error) {
          return {
            kind: 'error',
            text: `failed to switch preset: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
        return { kind: 'success', text: `preset ${name}` };
      },
    });
  });
}
