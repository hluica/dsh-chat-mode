/**
 * Logic-level tests for the preset-scope chat-mode plugin.
 *
 * These exercise the plugin's own decisions — permission pinning, tool
 * restrictions, dynamic tool-pack availability, command grammar, prompt
 * guidance, and the command-derived projection — against stubbed Cordis
 * services. They do not replace a live Web-session check; they catch the
 * regressions that are cheap to catch outside the Host.
 *
 * The harness mirrors the real command path: `command/run` is appended before
 * the handler, `command/done` after it, and the projection folds both.
 */
import { strict as assert } from 'node:assert'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const preset = await import(pathToFileURL(join(root, 'preset.js')).href)

/** Build one isolated harness with a fresh set of stubs. */
function harness(options = {}) {
  const {
    current: initialCurrent = 'workspace-write',
    tools: availableTools = ['bash', 'web_search'],
  } = options
  const events = []
  const commands = []
  const agentCommands = []
  const permissionSets = []
  const variables = new Map()
  const restrictions = []
  const handlers = new Map()
  const handlerOptions = new Map()
  let current = initialCurrent
  let projected = { shell: false, webSearch: false, wolfram: false, pending: {} }
  let projectionDefinition
  let commandCounter = 0

  const session = {
    id: 's1',
    header: { agentPreset: 'chat' },
    append(type, data) {
      const event = { type, data }
      events.push(event)
      if (projectionDefinition !== undefined) {
        projected = projectionDefinition.apply(projected, event)
      }
      return event
    },
  }

  const available = new Set(availableTools)
  const tools = {
    get(name) { return available.has(name) ? { name } : undefined },
    definitions() { return [...available].map(name => ({ name })) },
    restrict(filter) {
      restrictions.push({ kind: 'restrict', filter })
      // Real DSH emits an unfiltered `tools/change` on every restriction
      // registration and lift; the stub mirrors that so reentrancy bugs fail
      // the logic tests instead of only appearing at runtime.
      handlers.get('tools/change')?.()
      let active = true
      return () => {
        if (!active) return
        active = false
        restrictions.push({ kind: 'lift', filter })
        handlers.get('tools/change')?.()
      }
    },
  }

  const agent = {
    session,
    ctx: {
      tools,
      effect(callback, label) {
        const cleanup = callback()
        return () => { cleanup?.(); void label }
      },
      inject(deps, callback) {
        assert.deepEqual(deps, ['commands'])
        callback({
          commands: {
            register(definition) {
              agentCommands.push(definition)
              return () => {}
            },
          },
        })
        return () => {}
      },
    },
  }

  const ctx = {
    logger: { warn() {} },
    tools,
    systemPrompt: {
      variable(name, provider) {
        variables.set(name, provider)
        return () => {}
      },
    },
    sessionProjections: {
      async register(definition) {
        projectionDefinition = definition
        return { stateOf: () => projected }
      },
    },
    permissionPresets: {
      current() { return current },
      set(_session, name) {
        permissionSets.push(name)
        current = name
      },
    },
    agents: {
      get(id) { return id === session.id ? agent : undefined },
    },
    effect(callback) {
      const cleanup = callback()
      return () => { cleanup?.() }
    },
    on(event, handler, options) {
      handlers.set(event, handler)
      handlerOptions.set(event, options)
      return () => {}
    },
    inject(deps, callback) {
      assert.deepEqual(deps, ['commands'])
      callback({
        commands: {
          register(definition) {
            commands.push(definition)
            return () => {}
          },
        },
      })
      return () => {}
    },
  }

  /** Mirror the command runner: log run, invoke the handler, log done. */
  function runCommand(name, args, options = {}) {
    const definition = commands.find(entry => entry.name === name)
    assert.ok(definition, `missing command /${name}`)
    const commandId = `cmd-${++commandCounter}`
    session.append('command/run', { commandId, name, args, source: { kind: 'user' } })
    const result = definition.handler({ agent, rawInput: args })
    const kind = options.kind ?? (result?.kind === 'success' ? 'success' : 'error')
    session.append('command/done', {
      commandId,
      kind,
      text: result?.text ?? '',
    })
    return result
  }

  return {
    ctx,
    agent,
    session,
    events,
    commands,
    agentCommands,
    permissionSets,
    restrictions,
    handlers,
    handlerOptions,
    variables,
    runCommand,
    get projection() { return projected },
    get projectionDefinition() { return projectionDefinition },
    registerTool(name) { available.add(name) },
    removeTool(name) { available.delete(name) },
    get current() { return current },
  }
}

/** Run the plugin body against one harness. */
async function boot(options) {
  const h = harness(options)
  await preset.apply(h.ctx)
  return h
}

/** Find one registered slash command by name. */
function command(list, name) {
  const found = list.find(definition => definition.name === name)
  assert.ok(found, `missing command /${name}`)
  return found
}

const WOLFRAM_EVALUATOR = 'mcp__WolframLanguage__WolframLanguageEvaluator'
const WOLFRAM_CONTEXT = 'mcp__WolframLanguage__WolframLanguageContext'

// 1. Fresh Agent: read-only permission and both static advanced tools hidden.
// Without Wolfram tools there is no Wolfram deny entry, and the projection is
// the empty command-derived state.
{
  const h = await boot()
  h.handlers.get('agent/created')({ agent: h.agent, source: 'startup' })
  assert.deepEqual(h.permissionSets, ['read-only'], 'fresh chat should pin read-only')
  assert.equal(h.restrictions.length, 1, 'one restriction should be installed')
  assert.deepEqual(h.restrictions[0].filter, { deny: ['bash', 'web_search'] })
  assert.ok(command(h.commands, 'chat-tools'), '/chat-tools should be registered in the preset scope')
  assert.ok(command(h.commands, 'permission'), '/permission should be registered in the preset scope')
  assert.deepEqual(h.projection, { shell: false, webSearch: false, wolfram: false, pending: {} })
  assert.equal(h.variables.get('chat_tool_guidance')({ agent: h.agent }), '', 'no guidance when Wolfram is off')
  assert.deepEqual(h.events, [], 'the plugin must not append plugin-defined session events')
}

// 2. Resumed Agent keeps an allowed permission; a wider one is corrected.
{
  const h = await boot({ current: 'workspace-write' })
  h.handlers.get('agent/created')({ agent: h.agent, source: 'resume' })
  assert.deepEqual(h.permissionSets, [], 'resume should preserve workspace-write')
}
{
  const h = await boot({ current: 'danger-full-access' })
  h.handlers.get('agent/created')({ agent: h.agent, source: 'resume' })
  assert.deepEqual(h.permissionSets, ['read-only'], 'resume with a wider preset should be corrected')
}

// 3. `/chat-tools mode shell` is persisted through command/run + command/done
// and lifts only the shell mask.
{
  const h = await boot()
  h.handlers.get('agent/created')({ agent: h.agent, source: 'startup' })
  const result = h.runCommand('chat-tools', ' mode shell')
  assert.equal(result.kind, 'success')
  assert.deepEqual(h.events.map(event => event.type), ['command/run', 'command/done'])
  assert.deepEqual(h.events[0].data, {
    commandId: 'cmd-1',
    name: 'chat-tools',
    args: ' mode shell',
    source: { kind: 'user' },
  })
  assert.equal(h.events[1].data.kind, 'success')
  assert.deepEqual(h.projection, { shell: true, webSearch: false, wolfram: false, pending: {} })
  assert.deepEqual(h.restrictions.at(-2), { kind: 'lift', filter: { deny: ['bash', 'web_search'] } })
  assert.deepEqual(h.restrictions.at(-1), { kind: 'restrict', filter: { deny: ['web_search'] } })
}

// 4. The projection folds known command events, ignores other events, and has
// no plugin-defined event vocabulary.
{
  const h = await boot()
  const definition = h.projectionDefinition
  assert.equal(definition.stateVersion, 2, 'command-derived fold is stateVersion 2')
  const initial = { shell: false, webSearch: false, wolfram: false, pending: {} }
  const running = definition.apply(initial, {
    type: 'command/run',
    data: { commandId: 'cmd-9', name: 'chat-tools', args: ' mode both', source: { kind: 'user' } },
  })
  assert.deepEqual(running, { ...initial, pending: { 'cmd-9': ' mode both' } })
  const done = definition.apply(running, {
    type: 'command/done',
    data: { commandId: 'cmd-9', kind: 'success', text: 'ok' },
  })
  assert.deepEqual(done, { shell: true, webSearch: true, wolfram: false, pending: {} })
  assert.deepEqual(definition.wire.view(done), { shell: true, webSearch: true, wolfram: false })

  // A failed command removes its pending entry without changing the flags.
  const failedRun = definition.apply(initial, {
    type: 'command/run',
    data: { commandId: 'cmd-10', name: 'chat-tools', args: ' wolfram on', source: { kind: 'user' } },
  })
  assert.deepEqual(
    definition.apply(failedRun, { type: 'command/done', data: { commandId: 'cmd-10', kind: 'error', text: 'no' } }),
    initial,
  )

  // A report (no arguments) succeeds but changes nothing.
  const reportRun = definition.apply(initial, {
    type: 'command/run',
    data: { commandId: 'cmd-11', name: 'chat-tools', args: '', source: { kind: 'user' } },
  })
  assert.deepEqual(
    definition.apply(reportRun, { type: 'command/done', data: { commandId: 'cmd-11', kind: 'success', text: 'ok' } }),
    initial,
  )

  // Other commands and old plugin-defined events are ignored by reference.
  assert.equal(definition.apply(initial, { type: 'command/run', data: { name: 'permission' } }), initial)
  assert.equal(definition.apply(initial, { type: 'chat-mode/tools', data: { shell: true } }), initial)
  assert.equal(definition.apply(initial, { type: 'chat-mode/availability', data: { availability: {} } }), initial)

  // Historical state (pre-v2) normalizes without the removed availability map.
  assert.deepEqual(definition.stateSchema.parse({ shell: true, webSearch: false }), {
    shell: true,
    webSearch: false,
    wolfram: false,
    pending: {},
  })
  assert.throws(() => definition.stateSchema.parse(null))
  assert.throws(() => definition.stateSchema.parse({ shell: 'yes', webSearch: false }))
  assert.throws(() => definition.stateSchema.parse({ shell: false, webSearch: false, pending: { cmd: 1 } }))
}

// 5. `/permission` refuses full access and accepts the two allowed presets.
{
  const h = await boot()
  h.handlers.get('agent/created')({ agent: h.agent, source: 'startup' })
  const refused = h.runCommand('permission', ' danger-full-access')
  assert.equal(refused.kind, 'error')
  assert.deepEqual(h.permissionSets, ['read-only'], 'refusal must not change the permission')
  const accepted = h.runCommand('permission', ' workspace-write')
  assert.equal(accepted.kind, 'success')
  assert.deepEqual(h.permissionSets, ['read-only', 'workspace-write'])
}

// 6. The pre-execute guard denies a disabled gated tool and allows an enabled one.
{
  const h = await boot()
  h.handlers.get('agent/created')({ agent: h.agent, source: 'startup' })
  const guard = h.handlers.get('tools/pre-execute')
  const denied = await guard({ agent: h.agent, name: 'bash' }, async () => ({ kind: 'allow' }))
  assert.equal(denied.kind, 'deny')
  assert.match(denied.reason, /持久终端/u)
  h.runCommand('chat-tools', ' mode shell')
  const allowed = await guard({ agent: h.agent, name: 'bash' }, async () => ({ kind: 'allow' }))
  assert.equal(allowed.kind, 'allow')
  const webDenied = await guard({ agent: h.agent, name: 'web_search' }, async () => ({ kind: 'allow' }))
  assert.equal(webDenied.kind, 'deny')
}

// 7. The creation listener is prepend, and a late tool registration is caught by tools/change.
{
  const h = await boot({ tools: [] })
  assert.equal(h.handlerOptions.get('agent/created')?.prepend, true, 'creation listener should run before ordinary observers')
  h.handlers.get('agent/created')({ agent: h.agent, source: 'startup' })
  assert.equal(h.restrictions.length, 0, 'nothing to restrict before the tools register')
  h.registerTool('bash')
  h.registerTool('web_search')
  h.handlers.get('tools/change')()
  assert.equal(h.restrictions.at(-1).kind, 'restrict')
  assert.deepEqual(h.restrictions.at(-1).filter, { deny: ['bash', 'web_search'] })
}

// 8. Switching an already-created Agent to Chat applies the restriction from
// the selection event, before the next tools.resolve().
{
  const h = await boot()
  assert.equal(h.restrictions.length, 0, 'no restriction before the switch')
  h.handlers.get('session/event')(
    h.session,
    { type: 'agent-preset/selected', data: { agentPreset: 'chat' } },
  )
  assert.equal(h.restrictions.length, 1, 'switch should apply the restriction')
  assert.deepEqual(h.restrictions[0].filter, { deny: ['bash', 'web_search'] })
}

// 9. Wolfram tools appear: the pack is discovered, denied by default, enabled
// through the command path, and the guidance follows the projected flags.
{
  const h = await boot()
  h.handlers.get('agent/created')({ agent: h.agent, source: 'startup' })
  assert.deepEqual(h.restrictions[0].filter, { deny: ['bash', 'web_search'] })

  h.registerTool(WOLFRAM_EVALUATOR)
  h.registerTool(WOLFRAM_CONTEXT)
  h.handlers.get('tools/change')()
  assert.deepEqual(h.restrictions.at(-1).filter, {
    deny: ['bash', 'web_search', WOLFRAM_EVALUATOR, WOLFRAM_CONTEXT],
  })

  const guard = h.handlers.get('tools/pre-execute')
  const denied = await guard({ agent: h.agent, name: WOLFRAM_EVALUATOR }, async () => ({ kind: 'allow' }))
  assert.equal(denied.kind, 'deny')
  assert.match(denied.reason, /Wolfram/u)

  const enabled = h.runCommand('chat-tools', ' wolfram on')
  assert.equal(enabled.kind, 'success')
  assert.deepEqual(h.projection, { shell: false, webSearch: false, wolfram: true, pending: {} })
  assert.deepEqual(h.restrictions.at(-1).filter, { deny: ['bash', 'web_search'] })
  const allowed = await guard({ agent: h.agent, name: WOLFRAM_EVALUATOR }, async () => ({ kind: 'allow' }))
  assert.equal(allowed.kind, 'allow')
  assert.match(h.variables.get('chat_tool_guidance')({ agent: h.agent }), /Wolfram 工具/u)
  assert.match(h.variables.get('chat_tool_guidance')({ agent: h.agent }), /wolfram-\*/u)

  const disabled = h.runCommand('chat-tools', ' wolfram off')
  assert.equal(disabled.kind, 'success')
  assert.equal(h.variables.get('chat_tool_guidance')({ agent: h.agent }), '')
  assert.deepEqual(h.restrictions.at(-1).filter, {
    deny: ['bash', 'web_search', WOLFRAM_EVALUATOR, WOLFRAM_CONTEXT],
  })
}

// 10. Wolfram tools disappear: the next restriction drops the now-unknown
// names instead of throwing, and enabling the pack returns an error.
{
  const h = await boot({ tools: ['bash', 'web_search', WOLFRAM_EVALUATOR] })
  h.handlers.get('agent/created')({ agent: h.agent, source: 'startup' })
  assert.deepEqual(h.restrictions[0].filter, { deny: ['bash', 'web_search', WOLFRAM_EVALUATOR] })

  h.removeTool(WOLFRAM_EVALUATOR)
  h.handlers.get('tools/change')()
  assert.deepEqual(h.restrictions.at(-1).filter, { deny: ['bash', 'web_search'] })
  const rejected = h.runCommand('chat-tools', ' wolfram on')
  assert.equal(rejected.kind, 'error')
  assert.match(rejected.text, /not available/u)
  assert.deepEqual(h.projection, { shell: false, webSearch: false, wolfram: false, pending: {} })
}

// 11. Switching away from Chat disposes the restriction and stops replays.
{
  const h = await boot()
  h.handlers.get('agent/created')({ agent: h.agent, source: 'startup' })
  const before = h.restrictions.length
  h.handlers.get('session/event')(
    h.session,
    { type: 'agent-preset/selected', data: { agentPreset: 'standard' } },
  )
  assert.equal(h.restrictions.length, before + 1, 'switching away should lift the restriction')
  assert.equal(h.restrictions.at(-1).kind, 'lift')
  h.handlers.get('tools/change')()
  assert.equal(h.restrictions.length, before + 1, 'no restriction should be replayed after the switch')
}

// 12. The registry's global selection event is the fallback cleanup path for a
// switch that the preset revision's own session/event listener does not observe.
{
  const h = await boot()
  h.handlers.get('agent/created')({ agent: h.agent, source: 'startup' })
  const before = h.restrictions.length
  h.handlers.get('agent-preset/selected')('s1', 'standard')
  assert.equal(h.restrictions.length, before + 1, 'global selection should lift the restriction')
  h.handlers.get('tools/change')()
  assert.equal(h.restrictions.length, before + 1, 'global cleanup should stop replays')
}

// 13. A real log sequence replays to the same state from scratch.
{
  const h = await boot()
  const definition = h.projectionDefinition
  let state = definition.init()
  const sequence = [
    { type: 'command/run', data: { commandId: 'cmd-1', name: 'chat-tools', args: ' wolfram on', source: { kind: 'user' } } },
    { type: 'command/done', data: { commandId: 'cmd-1', kind: 'success', text: 'ok' } },
    { type: 'command/run', data: { commandId: 'cmd-2', name: 'chat-tools', args: ' mode both', source: { kind: 'user' } } },
    { type: 'command/done', data: { commandId: 'cmd-2', kind: 'success', text: 'ok' } },
  ]
  for (const event of sequence) state = definition.apply(state, event)
  assert.deepEqual(state, { shell: true, webSearch: true, wolfram: false, pending: {} })
}

console.log('chat-mode preset: all logic checks passed')
