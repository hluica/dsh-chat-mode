/**
 * Preset-scope half of chat mode.
 *
 * Mounted only by sessions that select the `chat` Agent preset. It owns:
 *
 * - the `chatMode` session projection (`{ shell, webSearch, wolfram, availability }`),
 *   folded from log-only `chat-mode/tools` and `chat-mode/availability` events so
 *   resume and fork keep the user's choice and the current tool availability;
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
 * followed through the unfiltered `tools/change` notification. Availability is
 * pushed to the browser through the session projection instead of polling a
 * Host route.
 *
 * The plugin is import-free on purpose: every DSH service it uses is reached
 * through the Cordis context, and the build system can keep the package's
 * dependency tree empty.
 */

/** Cordis plugin name used by loader diagnostics. */
export const name = 'chat-mode-preset';

/** Services required before the plugin body runs. */
export const inject = ['sessionProjections', 'permissionPresets', 'agents', 'systemPrompt', 'tools'];

/** Log-only whole-value event carrying the user's tool-enablement choice. */
const CHAT_TOOLS_EVENT = 'chat-mode/tools';

/** Log-only event carrying the latest dynamic tool-pack availability. */
const CHAT_AVAILABILITY_EVENT = 'chat-mode/availability';

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

/** Allowed availability-map keys (the same shape as prompt variable names). */
const AVAILABILITY_KEY = /^[a-z][a-z0-9_]*$/;

/** Activation flags off and no tool pack marked available. */
const DEFAULT_STATE = Object.freeze({
  shell: false,
  webSearch: false,
  wolfram: false,
  availability: Object.freeze({}),
});

/** Validate and normalize one availability map, tolerating an absent value. */
function normalizeAvailability(value) {
  if (value === undefined) return {};
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('chat-mode: expected an availability object');
  }
  const availability = {};
  for (const [key, flag] of Object.entries(value)) {
    if (!AVAILABILITY_KEY.test(key) || typeof flag !== 'boolean') {
      throw new Error('chat-mode: expected an availability map of boolean flags');
    }
    availability[key] = flag;
  }
  return availability;
}

/**
 * Runtime schema for the projection and its wire view. Historical states have
 * only `{ shell, webSearch }`; missing fields normalize to `false` / `{}`, so
 * an old checkpoint replays exactly like a full replay and `stateVersion`
 * stays 1 (optional-addition rule of the session projection contract).
 */
const stateSchema = {
  parse(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('chat-mode: expected { shell, webSearch, wolfram, availability }');
    }
    const flags = {};
    for (const key of ['shell', 'webSearch', 'wolfram']) {
      const flag = value[key];
      if (flag !== undefined && typeof flag !== 'boolean') {
        throw new Error(`chat-mode: expected ${key} to be a boolean`);
      }
      flags[key] = flag === true;
    }
    return { ...flags, availability: normalizeAvailability(value.availability) };
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

  // Per-session selected state awaiting the next accepted in-turn pre-step.
  const pending = new WeakMap();
  // Per-session restriction bookkeeping; strong refs, cleaned up with the preset
  // revision so a chat→other→chat switch cannot leak or duplicate a mask.
  const agents = new Map();
  // Sessions with an availability append already queued for the next microtask.
  const availabilityQueue = new Set();
  ctx.effect(() => () => {
    // Clear the registry before disposing so the synchronous `tools/change`
    // emitted by each lift cannot re-enter and re-install a mask while the
    // preset is unloading.
    const entries = [...agents.values()];
    agents.clear();
    availabilityQueue.clear();
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
    stateVersion: 1,
    stateSchema,
    init: () => ({ ...DEFAULT_STATE, availability: {} }),
    apply: (state, event) => {
      if (event.type === CHAT_TOOLS_EVENT) {
        return {
          shell: event.data?.shell === true,
          webSearch: event.data?.webSearch === true,
          wolfram: event.data?.wolfram === true,
          availability: state.availability,
        };
      }
      if (event.type === CHAT_AVAILABILITY_EVENT) {
        let next;
        try {
          next = normalizeAvailability(event.data?.availability);
        } catch {
          return state;
        }
        let changed = false;
        for (const [key, value] of Object.entries(next)) {
          if (state.availability[key] !== value) {
            changed = true;
            break;
          }
        }
        if (!changed) return state;
        return { ...state, availability: { ...state.availability, ...next } };
      }
      return state;
    },
    wire: {
      viewSchema: stateSchema,
      view: state => ({
        shell: state.shell,
        webSearch: state.webSearch,
        wolfram: state.wolfram,
        availability: state.availability,
      }),
    },
  });

  /** The logged state, normalized to the current shape. */
  const liveState = (session) => {
    try {
      const state = projection.stateOf(session);
      return {
        shell: state.shell === true,
        webSearch: state.webSearch === true,
        wolfram: state.wolfram === true,
        availability: state.availability ?? {},
      };
    } catch {
      return { ...DEFAULT_STATE, availability: {} };
    }
  };

  /** The selected state: an in-memory pending choice wins over the logged one. */
  const stateOf = (session) => {
    const live = liveState(session);
    const wanted = pending.get(session);
    if (wanted === undefined) return live;
    return {
      ...live,
      shell: wanted.shell === true,
      webSearch: wanted.webSearch === true,
      wolfram: wanted.wolfram === true,
    };
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

  const hasOpenTurn = (session) => {
    try {
      return ctx.agents.turnBoundaryOf(session).openTurnStartSeq !== null;
    } catch {
      return false;
    }
  };

  const appendState = (session, state) => {
    session.append(CHAT_TOOLS_EVENT, {
      shell: state.shell,
      webSearch: state.webSearch,
      wolfram: state.wolfram,
    });
    pending.delete(session);
  };

  /** Append the changed availability flags, deferred out of append publication. */
  const syncAvailability = (session) => {
    // The header preset is immutable metadata and does not follow a switch;
    // the registry entry itself is the authoritative "this session is chat" marker.
    if (!agents.has(session)) return;
    const live = liveState(session);
    const next = availabilityOf();
    const changed = {};
    for (const [id, value] of Object.entries(next)) {
      if (live.availability[id] !== value) changed[id] = value;
    }
    if (Object.keys(changed).length === 0) return;
    try {
      session.append(CHAT_AVAILABILITY_EVENT, { availability: changed });
    } catch (error) {
      warn(`chat-mode: failed to record tool availability: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  /**
   * Queue one availability check for a Session. `tools/change` and the
   * projection drive both run inside publication/notification paths where a
   * synchronous `session.append()` would be refused, so the append is always
   * deferred to a microtask.
   */
  const scheduleAvailabilitySync = (session) => {
    if (availabilityQueue.has(session)) return;
    availabilityQueue.add(session);
    queueMicrotask(() => {
      availabilityQueue.delete(session);
      syncAvailability(session);
    });
  };

  /** Forget a Session that switched away from Chat. */
  const clearSession = (session) => {
    pending.delete(session);
    availabilityQueue.delete(session);
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
      entry = { agent, known: {}, dispose: undefined, key: '' };
      agents.set(session, entry);
    } else {
      entry.agent = agent;
    }
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
    scheduleAvailabilitySync(agent.session);
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
      scheduleAvailabilitySync(session);
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

  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
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
        scheduleAvailabilitySync(agent.session);
      } catch (error) {
        warn(`chat-mode: pre-step restriction failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const decision = await next();
    if (decision.kind === 'reject' || signal.aborted) return decision;
    const wanted = pending.get(agent.session);
    if (wanted === undefined) return decision;
    try {
      appendState(agent.session, wanted);
    } catch (error) {
      warn(`chat-mode: failed to append chat tools at step start: ${error instanceof Error ? error.message : String(error)}`);
    }
    return decision;
  });

  // A tool registration can land after `agent/created` (or a preset reload can
  // replace the tool set). Re-apply the current per-Agent mask whenever the
  // registry changes; `applyRestrictions` deduplicates by its key, so the
  // `tools/change` emitted by our own restrict() terminates immediately.
  // Dynamic packs (Wolfram MCP) appear and disappear here; availability is
  // pushed to the projection so the browser follows without polling.
  ctx.on('tools/change', () => {
    for (const [session, entry] of agents) {
      try {
        applyRestrictions(entry.agent, stateOf(session));
        scheduleAvailabilitySync(session);
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
        pending.set(agent.session, next);
        applyRestrictions(agent, next);
        scheduleAvailabilitySync(agent.session);
        if (hasOpenTurn(agent.session)) {
          return {
            kind: 'success',
            text: `chat tools: ${describeState(next, availability)} (applies from the next step)`,
          };
        }
        try {
          appendState(agent.session, next);
        } catch (error) {
          return {
            kind: 'error',
            text: `failed to record chat tools: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
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
