/**
 * Preset-scope half of chat mode.
 *
 * Mounted only by sessions that select the `chat` Agent preset. It owns:
 *
 * - the `chatMode` session projection (`{ shell, webSearch }`), folded from the
 *   log-only `chat-mode/tools` event so resume and fork keep the user's choice;
 * - the initial permission lock: a fresh chat session is pinned to `read-only`,
 *   and a resumed/cleared/compacted session keeps only `read-only` or
 *   `workspace-write`;
 * - an Agent-scoped `/permission` command that shadows the global one and
 *   refuses `danger-full-access`;
 * - the preset-scoped `/chat-tools` command that toggles shell and web search;
 * - `tools.restrict()` masks that hide disabled tools from the model, plus a
 *   `tools/pre-execute` guard for batches resolved before a toggle.
 *
 * The plugin is import-free on purpose: every DSH service it uses is reached
 * through the Cordis context, and the build system can keep the package's
 * dependency tree empty.
 */

/** Cordis plugin name used by loader diagnostics. */
export const name = 'chat-mode-preset';

/** Services required before the plugin body runs. */
export const inject = ['sessionProjections', 'permissionPresets', 'agents'];

/** Log-only whole-value event carrying the user's tool-enablement choice. */
const CHAT_TOOLS_EVENT = 'chat-mode/tools';

/** Projection key published to the browser half. */
const CHAT_MODE_PROJECTION = 'chatMode';

/** Off for both advanced tools until the user enables them. */
const DEFAULT_STATE = Object.freeze({ shell: false, webSearch: false });

/** The two permission presets a chat session may use. */
const ALLOWED_PERMISSIONS = new Set(['read-only', 'workspace-write']);

/**
 * Minimal runtime schema for the projection and its wire view. The session
 * projection runtime only needs `parse(value)`; avoiding zod keeps this plugin
 * dependency-free.
 */
const stateSchema = {
  parse(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)
      || typeof value.shell !== 'boolean' || typeof value.webSearch !== 'boolean') {
      throw new Error('chat-mode: expected { shell: boolean, webSearch: boolean }')
    }
    return value
  },
};

/** The platform's persistent shell tool name. */
function shellToolName() {
  return process.platform === 'win32' ? 'pwsh' : 'bash'
}

/** Whether one tool call is currently gated by the chat-mode state. */
function isGated(name, state) {
  if (name === 'bash' || name === 'pwsh') return state.shell !== true
  if (name === 'web_search') return state.webSearch !== true
  return false
}

/** Model-facing denial text for a disabled advanced tool. */
function gateReason(name) {
  if (name === 'web_search') {
    return 'web_search is disabled in chat mode. Ask the user to enable “联网搜索” in the chat toolbar (对话设置) before searching.'
  }
  return `The shell tool "${name}" is disabled in chat mode. Ask the user to enable “命令执行” in the chat toolbar (对话设置) before running commands.`
}

/** Parse the `/chat-tools` argument grammar into the next state, or an error string. */
function parseToolsCommand(rawInput, current) {
  const parts = rawInput.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { kind: 'report' }
  if (parts[0] === 'mode' && parts.length === 2) {
    switch (parts[1]) {
      case 'off': return { kind: 'state', state: { shell: false, webSearch: false } }
      case 'shell': return { kind: 'state', state: { shell: true, webSearch: false } }
      case 'search': return { kind: 'state', state: { shell: false, webSearch: true } }
      case 'both': return { kind: 'state', state: { shell: true, webSearch: true } }
      default: return { kind: 'error', text: 'expected one of: off, shell, search, both' }
    }
  }
  if ((parts[0] === 'shell' || parts[0] === 'search') && parts.length === 2) {
    if (parts[1] !== 'on' && parts[1] !== 'off') return { kind: 'error', text: 'expected on or off' }
    const state = { shell: current.shell, webSearch: current.webSearch }
    if (parts[0] === 'shell') state.shell = parts[1] === 'on'
    else state.webSearch = parts[1] === 'on'
    return { kind: 'state', state }
  }
  return { kind: 'error', text: 'usage: /chat-tools [mode off|shell|search|both] [shell on|off] [search on|off]' }
}

/**
 * Chat-mode preset plugin body.
 * @param ctx - preset-scope Cordis context (the preset revision is shared by
 * every session selecting `chat`).
 */
export async function apply(ctx) {
  const warn = (message) => {
    try {
      ctx.logger?.warn?.(message)
    } catch {
      // Logging must never break a tool call or agent creation.
    }
  }

  // Per-session selected state awaiting the next accepted in-turn pre-step.
  const pending = new WeakMap()
  // Per-session restriction bookkeeping; strong refs, cleaned up with the preset
  // revision so a chat→other→chat switch cannot leak or duplicate a mask.
  const agents = new Map()
  ctx.effect(() => () => {
    for (const entry of agents.values()) {
      if (entry.dispose === undefined) continue
      try {
        entry.dispose()
      } catch {
        // The Agent scope may already have disposed it.
      }
    }
    agents.clear()
  }, 'chat-mode: preset restrictions cleanup')

  const projection = await ctx.sessionProjections.register({
    key: CHAT_MODE_PROJECTION,
    stateVersion: 1,
    stateSchema,
    init: () => ({ ...DEFAULT_STATE }),
    apply: (state, event) => {
      if (event.type !== CHAT_TOOLS_EVENT) return state
      return {
        shell: event.data?.shell === true,
        webSearch: event.data?.webSearch === true,
      }
    },
    wire: {
      viewSchema: stateSchema,
      view: state => ({ shell: state.shell, webSearch: state.webSearch }),
    },
  })

  /** The selected state: an in-memory pending choice wins over the logged one. */
  const stateOf = (session) => {
    const wanted = pending.get(session)
    if (wanted !== undefined) return wanted
    try {
      const state = projection.stateOf(session)
      return { shell: state.shell === true, webSearch: state.webSearch === true }
    } catch {
      return { ...DEFAULT_STATE }
    }
  }

  const hasOpenTurn = (session) => {
    try {
      return ctx.agents.turnBoundaryOf(session).openTurnStartSeq !== null
    } catch {
      return false
    }
  }

  const appendState = (session, state) => {
    session.append(CHAT_TOOLS_EVENT, { shell: state.shell, webSearch: state.webSearch })
    pending.delete(session)
  }

  /**
   * Apply the model-visible restriction for one Agent. The restriction is
   * registered on the Agent scope, where it masks inherited preset tools; the
   * preset's own scope stays untouched, so other chat sessions are unaffected.
   */
  const applyRestrictions = (agent, state) => {
    const session = agent.session
    let entry = agents.get(session)
    if (entry === undefined) {
      entry = { agent, known: undefined, dispose: undefined, key: '' }
      agents.set(session, entry)
    } else {
      entry.agent = agent
    }
    // Recompute an empty list: the first `agent/created` may run before the
    // preset's tool plugins have registered, and `tools/change` retries.
    if (entry.known === undefined || entry.known.length === 0) {
      const candidates = [shellToolName(), 'web_search']
      entry.known = candidates.filter((tool) => {
        try {
          return agent.ctx.tools.get(tool, agent) !== undefined
        } catch {
          return false
        }
      })
    }
    const deny = entry.known.filter(tool => isGated(tool, state))
    const key = deny.join(',')
    if (key === entry.key) return
    if (entry.dispose !== undefined) {
      try {
        entry.dispose()
      } catch {
        // The restriction may already be gone with the agent scope.
      }
      entry.dispose = undefined
    }
    entry.key = key
    if (deny.length === 0) return
    try {
      entry.dispose = agent.ctx.tools.restrict({ deny })
    } catch (error) {
      warn(`chat-mode: failed to restrict ${deny.join(', ')}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Lock a session's permission. Fresh sessions (`source === 'startup'`) start
   * at read-only; a resumed/cleared/compacted session keeps an allowed choice
   * and is corrected to read-only when it carries anything wider.
   */
  const pinPermission = (session, source) => {
    let current = 'custom'
    try {
      current = ctx.permissionPresets.current(session)
    } catch (error) {
      warn(`chat-mode: cannot read current permission: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (source !== 'startup' && ALLOWED_PERMISSIONS.has(current)) return
    if (current === 'read-only') return
    try {
      ctx.permissionPresets.set(session, 'read-only')
    } catch (error) {
      warn(`chat-mode: failed to pin read-only: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Apply the initial state and permission lock for one Agent. The `/permission`
   * command lives in the preset scope (registered once alongside `/chat-tools`)
   * so a chat→other→chat switch cannot duplicate an Agent-scoped command.
   */
  const initializeAgent = (agent, source) => {
    applyRestrictions(agent, stateOf(agent.session))
    pinPermission(agent.session, source)
  }

  ctx.on('agent/created', ({ agent, source }) => {
    try {
      initializeAgent(agent, source)
    } catch (error) {
      // A failed chat-mode setup must not reject Agent creation; the permission
      // and restriction state simply stays at the composition defaults.
      warn(`chat-mode: initialization failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, { prepend: true })

  // A blank/live session can be switched to Chat after its Agent already
  // exists. `agent/created` will not fire again, so apply the restriction from
  // the selection event itself. The Agent scope is already live; this runs
  // before the next `tools.resolve()` and fixes the first turn after a switch.
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'agent-preset/selected') return
    if (event.data?.agentPreset !== 'chat') return
    const agent = ctx.agents.get(session.id)
    if (agent === undefined) return
    try {
      applyRestrictions(agent, stateOf(session))
    } catch (error) {
      warn(`chat-mode: preset switch restriction failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    // Fallback for a composition where the creation event did not reach the
    // preset scope: apply restrictions and the permission lock before the step
    // is prepared. The normal path is `agent/created`.
    if (!agents.has(agent.session)) {
      try {
        initializeAgent(agent, undefined)
      } catch (error) {
        warn(`chat-mode: lazy initialization failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    } else {
      // Keep the registry restriction fresh. Note the loop resolves the tool
      // set before this waterfall, so this only affects later steps.
      try {
        applyRestrictions(agent, stateOf(agent.session))
      } catch (error) {
        warn(`chat-mode: pre-step restriction failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    const wanted = pending.get(agent.session)
    if (wanted === undefined) return decision
    try {
      appendState(agent.session, wanted)
    } catch (error) {
      warn(`chat-mode: failed to append chat tools at step start: ${error instanceof Error ? error.message : String(error)}`)
    }
    return decision
  })

  // A tool registration can land after `agent/created` (or a preset reload can
  // replace the tool set). Re-apply the current per-Agent mask whenever the
  // registry changes; `applyRestrictions` deduplicates by its key, so the
  // `tools/change` emitted by our own restrict() terminates immediately.
  ctx.on('tools/change', () => {
    for (const [session, entry] of agents) {
      try {
        applyRestrictions(entry.agent, stateOf(session))
      } catch (error) {
        warn(`chat-mode: tools/change restriction failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  })

  // Defense in depth: a batch resolved before a restriction change can still
  // carry a now-disabled tool. The guard turns that call into a clear denial.
  ctx.on('tools/pre-execute', async (exec, next) => {
    if (exec.agent === undefined) return next()
    if (!isGated(exec.name, stateOf(exec.agent.session))) return next()
    return { kind: 'deny', reason: gateReason(exec.name) }
  })

  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.commands.register({
      name: 'chat-tools',
      description: 'Enable or disable advanced tools in chat mode',
      input: { hint: '[mode off|shell|search|both] [shell on|off] [search on|off]' },
      handler: ({ agent, rawInput }) => {
        const current = stateOf(agent.session)
        const parsed = parseToolsCommand(rawInput, current)
        if (parsed.kind === 'error') return { kind: 'error', text: parsed.text }
        if (parsed.kind === 'report') {
          return {
            kind: 'success',
            text: `chat tools: shell=${current.shell ? 'on' : 'off'}, web_search=${current.webSearch ? 'on' : 'off'}`,
          }
        }
        const next = parsed.state
        if (next.shell === current.shell && next.webSearch === current.webSearch) {
          return {
            kind: 'success',
            text: `chat tools unchanged: shell=${next.shell ? 'on' : 'off'}, web_search=${next.webSearch ? 'on' : 'off'}`,
          }
        }
        pending.set(agent.session, next)
        applyRestrictions(agent, next)
        if (hasOpenTurn(agent.session)) {
          return {
            kind: 'success',
            text: `chat tools: shell=${next.shell ? 'on' : 'off'}, web_search=${next.webSearch ? 'on' : 'off'} (applies from the next step)`,
          }
        }
        try {
          appendState(agent.session, next)
        } catch (error) {
          return {
            kind: 'error',
            text: `failed to record chat tools: ${error instanceof Error ? error.message : String(error)}`,
          }
        }
        return {
          kind: 'success',
          text: `chat tools: shell=${next.shell ? 'on' : 'off'}, web_search=${next.webSearch ? 'on' : 'off'}`,
        }
      },
    })

    // Preset-scope `/permission` shadow: available to every Chat Agent, and
    // disposed/re-registered with the preset revision instead of accumulating
    // Agent-scoped command registrations across a chat→other→chat switch.
    commandCtx.commands.register({
      name: 'permission',
      description: 'Switch the permission preset (chat mode allows read-only or workspace-write only)',
      input: { hint: 'read-only|workspace-write' },
      handler: ({ agent: receiving, rawInput }) => {
        const name = rawInput.trim()
        if (name === '') {
          let current = 'unknown'
          try {
            current = ctx.permissionPresets.current(receiving.session)
          } catch {
            // Report the fallback value.
          }
          return {
            kind: 'success',
            text: `current preset ${current} (available: read-only, workspace-write)`,
          }
        }
        if (name !== 'read-only' && name !== 'workspace-write') {
          return {
            kind: 'error',
            text: `Chat mode only allows read-only or workspace-write; "${name}" is unavailable.`,
          }
        }
        try {
          ctx.permissionPresets.set(receiving.session, name)
        } catch (error) {
          return {
            kind: 'error',
            text: `failed to switch preset: ${error instanceof Error ? error.message : String(error)}`,
          }
        }
        return { kind: 'success', text: `preset ${name}` }
      },
    })
  })
}
