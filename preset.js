/**
 * Preset-scope half of chat mode.
 *
 * Mounted only by sessions that select the `chat` Agent preset. It owns:
 *
 * - the `chatMode` session projection (`{ shell, webSearch, wolfram }`), folded
 *   from the known `command/run` + `command/done` events of the preset-scoped
 *   `/chat-tools` command, so resume and fork keep the user's choice without
 *   writing any plugin-defined event type;
 * - a table of **tool packs** (shell, web search, Wolfram MCP) that share one
 *   discovery / availability / restriction / prompt-guidance path;
 * - the initial permission lock: a fresh chat session is pinned to `read-only`,
 *   and a resumed/cleared/compacted session keeps only `read-only` or
 *   `workspace-write`;
 * - an Agent-scoped `/permission` command that shadows the global one and
 *   refuses `danger-full-access`;
 * - the preset-scoped `/chat-tools` command that toggles the tool packs;
 * - `tools.restrict()` masks that hide disabled packs from the model, plus a
 *   `tools/pre-execute` guard for batches resolved before a toggle;
 * - the `chat_tool_guidance` prompt variable consumed by the persona prefix.
 *
 * Dynamic packs (Wolfram) are discovered from the global tool registry and
 * followed through the unfiltered `tools/change` notification. Their live
 * availability reaches the browser through the Host half's
 * `/dsh-chat-mode/api/state` route (polled by the Client half); no session event
 * is appended, because `Session.append()` cannot mark an unknown type
 * `ignorable` and such a log would refuse to reopen.
 *
 * The plugin is import-free on purpose: every DSH service it uses is reached
 * through the Cordis context, and the build system can keep the package's
 * dependency tree empty.
 */

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

/** Stable model-facing namespace of the Wolfram MCP server. */
const WOLFRAM_PREFIX = 'mcp__WolframLanguage__';

/** Guidance injected only while Wolfram tools are available and enabled. */
const WOLFRAM_GUIDANCE = [
  'Wolfram 工具：',
  '- 当前会话已启用 Wolfram Language 工具（mcp__WolframLanguage__*），它们已经出现在工具列表中，可直接调用，无需再向用户确认是否启用。',
  '- 当用户需要具体、明确的计算任务（数值计算、数据处理、符号推导、方程求解、单位与实体换算、可视化等）、符号推理或形式化变换时，应当调用 Wolfram 工具，而不要只凭心算或近似推理作答。',
  '- 当问题属于观点性讨论、创意写作、纯粹的语言任务，或者近似推理即可满足要求时，不应当调用 Wolfram 工具。',
  '- Wolfram 技能文档位于 `~/.dsh/skills/wolfram-*/`（wolfram-language、wolfram-notebooks、wolfram-paclets、wolfram-debugging）；需要更详细的用法时，先阅读对应目录下的 SKILL.md。',
].join('\n');

/**
 * The tool packs chat mode gates.
 *
 * A pack is one menu item and one or more model-facing tools:
 * - `names` lists statically registered tools (they are found through the
 *   Agent view and cached because a restriction hides them afterwards);
 * - `prefix` discovers a dynamic family from the global registry on every
 *   change, so MCP registration and removal need no extra wiring;
 * - `guidance` is folded into the prompt variable while the pack is available
 *   and enabled.
 */
const TOOL_PACKS = [
  {
    id: 'shell',
    stateKey: 'shell',
    names: () => [shellToolName()],
    denyReason: 'The shell tool is disabled in chat mode. Ask the user to enable “持久终端” in the chat toolbar (对话设置) before running commands.',
  },
  {
    id: 'search',
    stateKey: 'webSearch',
    names: () => ['web_search'],
    denyReason: 'web_search is disabled in chat mode. Ask the user to enable “联网搜索” in the chat toolbar (对话设置) before searching.',
  },
  {
    id: 'wolfram',
    stateKey: 'wolfram',
    prefix: WOLFRAM_PREFIX,
    denyReason: 'Wolfram tools are disabled in chat mode. Ask the user to enable “Wolfram” in the chat toolbar (对话设置) before using them.',
    guidance: WOLFRAM_GUIDANCE,
  },
];

/** The Wolfram pack, used for command-time availability checks. */
const WOLFRAM_PACK = TOOL_PACKS.find(pack => pack.id === 'wolfram');

/** The two permission presets a chat session may use. */
const ALLOWED_PERMISSIONS = new Set(['read-only', 'workspace-write']);

/** Activation flags off and no command awaiting its `command/done`. */
const DEFAULT_STATE = Object.freeze({
  shell: false,
  webSearch: false,
  wolfram: false,
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

/** Validate and normalize the three activation flags. */
function parseFlags(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('chat-mode: expected { shell, webSearch, wolfram }');
  }
  const flags = {};
  for (const key of ['shell', 'webSearch', 'wolfram']) {
    const flag = value[key];
    if (flag !== undefined && typeof flag !== 'boolean') {
      throw new Error(`chat-mode: expected ${key} to be a boolean`);
    }
    flags[key] = flag === true;
  }
  return flags;
}

/**
 * Runtime schema for the projection.
 *
 * `stateVersion` is 2 because the fold moved from plugin-defined events to the
 * known `command/run` / `command/done` pair. A version-1 checkpoint is
 * discarded by the projection cache instead of being reinterpreted under the
 * new semantics. Missing fields normalize to `false` / `{}`.
 */
const stateSchema = {
  parse(value) {
    return { ...parseFlags(value), pending: normalizePending(value?.pending) };
  },
};

/** Wire schema: the Client only needs the three activation flags. */
const wireSchema = {
  parse(value) {
    return parseFlags(value);
  },
};

/** The platform's persistent shell tool name. */
function shellToolName() {
  return process.platform === 'win32' ? 'pwsh' : 'bash';
}

/** The pack that owns one model-facing tool name, if any. */
function packForTool(toolName) {
  for (const pack of TOOL_PACKS) {
    if (pack.prefix !== undefined) {
      if (toolName.startsWith(pack.prefix)) return pack;
    } else if (pack.names !== undefined && pack.names().includes(toolName)) {
      return pack;
    }
  }
  return undefined;
}

/** Whether one tool call is currently gated by the chat-mode state. */
function isGated(toolName, state) {
  const pack = packForTool(toolName);
  return pack !== undefined && state[pack.stateKey] !== true;
}

/** Model-facing denial text for a disabled gated tool. */
function gateReason(toolName) {
  return packForTool(toolName)?.denyReason
    ?? `The tool "${toolName}" is disabled in chat mode.`;
}

/** The three activation flags, independent of availability. */
function flags(shell, webSearch, wolfram) {
  return { shell, webSearch, wolfram };
}

/** Parse the `/chat-tools` argument grammar into the next state, or an error string. */
function parseToolsCommand(rawInput, current) {
  const parts = rawInput.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { kind: 'report' };
  if (parts[0] === 'mode' && parts.length === 2) {
    switch (parts[1]) {
      case 'off': return { kind: 'state', state: flags(false, false, false) };
      case 'shell': return { kind: 'state', state: flags(true, false, false) };
      case 'search': return { kind: 'state', state: flags(false, true, false) };
      case 'both': return { kind: 'state', state: flags(true, true, false) };
      case 'wolfram': return { kind: 'state', state: flags(false, false, true) };
      case 'all': return { kind: 'state', state: flags(true, true, true) };
      default: return { kind: 'error', text: 'expected one of: off, shell, search, both, wolfram, all' };
    }
  }
  const stateKey = { shell: 'shell', search: 'webSearch', wolfram: 'wolfram' }[parts[0]];
  if (stateKey !== undefined && parts.length === 2) {
    if (parts[1] !== 'on' && parts[1] !== 'off') return { kind: 'error', text: 'expected on or off' };
    const state = flags(current.shell === true, current.webSearch === true, current.wolfram === true);
    state[stateKey] = parts[1] === 'on';
    return { kind: 'state', state };
  }
  return {
    kind: 'error',
    text: 'usage: /chat-tools [mode off|shell|search|both|wolfram|all] [shell on|off] [search on|off] [wolfram on|off]',
  };
}

/** Human-readable activation summary for command results. */
function describeState(state, availability) {
  const wolfram = availability.wolfram === true
    ? (state.wolfram === true ? 'on' : 'off')
    : 'unavailable';
  return `shell=${state.shell === true ? 'on' : 'off'}, web_search=${state.webSearch === true ? 'on' : 'off'}, wolfram=${wolfram}`;
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

  /** The Wolfram pack's live availability from the global tool registry. */
  const globalToolNames = () => {
    try {
      return ctx.tools.definitions().map(definition => definition.name);
    } catch {
      return [];
    }
  };

  /** Whether a dynamic pack currently has at least one registered tool. */
  const packAvailable = (pack) => {
    if (pack.prefix === undefined) return true;
    return globalToolNames().some(name => name.startsWith(pack.prefix));
  };

  /** The availability snapshot for every dynamic pack. */
  const availabilityOf = () => {
    const availability = {};
    for (const pack of TOOL_PACKS) {
      if (pack.prefix !== undefined) availability[pack.id] = packAvailable(pack);
    }
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
    // v2: the fold moved from plugin-defined events to command/run +
    // command/done. A v1 checkpoint must be discarded, not reinterpreted.
    stateVersion: 2,
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
          wolfram: parsed.state.wolfram,
          pending,
        };
      }
      return state;
    },
    wire: {
      viewSchema: wireSchema,
      view: state => ({
        shell: state.shell,
        webSearch: state.webSearch,
        wolfram: state.wolfram,
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
        wolfram: state.wolfram === true,
      };
    } catch {
      return { shell: false, webSearch: false, wolfram: false };
    }
  };

  /**
   * Discover one pack's model-facing tool names for an Agent.
   *
   * Dynamic (`prefix`) packs read the **global** registry: the Agent view
   * applies our own restriction, so using it here would make a disabled pack
   * look absent and lift its mask. Static (`names`) packs read the Agent view
   * and cache the successful first discovery for the same reason.
   */
  const packToolNames = (agent, entry, pack) => {
    if (pack.prefix !== undefined) {
      return globalToolNames().filter(name => name.startsWith(pack.prefix));
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
    for (const pack of TOOL_PACKS) {
      if (pack.guidance === undefined) continue;
      if (state[pack.stateKey] !== true) continue;
      const available = pack.prefix === undefined
        ? packToolNames(agent, undefined, pack).length > 0
        : packAvailable(pack);
      if (!available) continue;
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
      for (const pack of TOOL_PACKS) {
        if (state[pack.stateKey] === true) continue;
        deny.push(...packToolNames(agent, entry, pack));
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
  // Dynamic packs (Wolfram MCP) appear and disappear here; the Client half
  // polls the Host availability route to update the menu item.
  ctx.on('tools/change', () => {
    for (const [session, entry] of agents) {
      try {
        applyRestrictions(entry.agent, stateOf(session));
      } catch (error) {
        warn(`chat-mode: tools/change restriction failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  });

  // Defense in depth: a batch resolved before a restriction change can still
  // carry a now-disabled tool. The guard turns that call into a clear denial.
  ctx.on('tools/pre-execute', async (exec, next) => {
    if (exec.agent === undefined) return next();
    if (!isGated(exec.name, stateOf(exec.agent.session))) return next();
    return { kind: 'deny', reason: gateReason(exec.name) };
  });

  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.commands.register({
      name: 'chat-tools',
      description: 'Enable or disable advanced tools in chat mode',
      input: { hint: '[mode off|shell|search|both|wolfram|all] [shell on|off] [search on|off] [wolfram on|off]' },
      handler: ({ agent, rawInput }) => {
        const current = stateOf(agent.session);
        const availability = availabilityOf();
        const parsed = parseToolsCommand(rawInput, current);
        if (parsed.kind === 'error') return { kind: 'error', text: parsed.text };
        if (parsed.kind === 'report') {
          return { kind: 'success', text: `chat tools: ${describeState(current, availability)}` };
        }
        const next = parsed.state;
        if (next.wolfram === true && availability[WOLFRAM_PACK.id] !== true) {
          return { kind: 'error', text: 'Wolfram tools are not available in this session.' };
        }
        if (next.shell === current.shell && next.webSearch === current.webSearch && next.wolfram === current.wolfram) {
          return { kind: 'success', text: `chat tools unchanged: ${describeState(next, availability)}` };
        }
        // Apply immediately. The durable choice is the command/run +
        // command/done pair the command runner logs for this invocation; the
        // projection folds it back on resume and fork.
        applyRestrictions(agent, next);
        return { kind: 'success', text: `chat tools: ${describeState(next, availability)}` };
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
