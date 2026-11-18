/**
 * Logic-level tests for the preset-scope chat-mode plugin.
 *
 * These exercise the plugin's own decisions — permission pinning, tool
 * restrictions, dynamic tool-pack availability, command grammar, prompt
 * guidance, and the projection fold — against stubbed Cordis services. They do
 * not replace a live Web-session check; they catch the regressions that are
 * cheap to catch outside the Host.
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
    openTurn = false,
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
  let logged = { shell: false, webSearch: false, wolfram: false, availability: {} }
  let projectionDefinition
  let turnOpen = openTurn

  const session = {
    id: 's1',
    header: { agentPreset: 'chat' },
    append(type, data) {
      events.push({ type, data })
      if (type === 'chat-mode/tools') {
        logged = {
          ...logged,
          shell: data.shell === true,
          webSearch: data.webSearch === true,
          wolfram: data.wolfram === true,
        }
      } else if (type === 'chat-mode/availability') {
        logged = {
          ...logged,
          availability: { ...logged.availability, ...(data.availability ?? {}) },
        }
      }
      return { type, data }
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
        return { stateOf: () => logged }
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
      turnBoundaryOf() { return { openTurnStartSeq: turnOpen ? 1 : null } },
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
    get projectionDefinition() { return projectionDefinition },
    setTurnOpen(value) { turnOpen = value },
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

/** Let deferred availability appends settle. */
async function flush() {
  await Promise.resolve()
  await Promise.resolve()
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
// Without Wolfram tools there is no Wolfram deny entry or menu availability.
{
  const h = await boot()
  h.handlers.get('agent/created')({ agent: h.agent, source: 'startup' })
  assert.deepEqual(h.permissionSets, ['read-only'], 'fresh chat should pin read-only')
  assert.equal(h.restrictions.length, 1, 'one restriction should be installed')
  assert.deepEqual(h.restrictions[0].filter, { deny: ['bash', 'web_search'] })
  assert.ok(command(h.commands, 'chat-tools'), '/chat-tools should be registered in the preset scope')
  assert.ok(command(h.commands, 'permission'), '/permission should be registered in the preset scope')
  await flush()
  assert.deepEqual(h.events.at(-1), {
    type: 'chat-mode/availability',
    data: { availability: { wolfram: false } },
  })
  assert.equal(h.variables.get('chat_tool_guidance')({ agent: h.agent }), '', 'no guidance when Wolfram is off')
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

// 3. `/chat-tools mode shell` records the event and lifts only the shell mask.
{
  const h = await boot()
  h.handlers.get('agent/created')({ agent: h.agent, source: 'startup' })
  await flush()
  const tools = command(h.commands, 'chat-tools')
  const result = tools.handler({ agent: h.agent, rawInput: 'mode shell' })
  assert.equal(result.kind, 'success')
  assert.deepEqual(h.events.at(-1), {
    type: 'chat-mode/tools',
    data: { shell: true, webSearch: false, wolfram: false },
  })
  assert.deepEqual(h.restrictions.at(-2), { kind: 'lift', filter: { deny: ['bash', 'web_search'] } })
  assert.deepEqual(h.restrictions.at(-1), { kind: 'restrict', filter: { deny: ['web_search'] } })
}

// 4. The projection fold, backward compatibility, and wire view.
{
  const h = await boot()
  const definition = h.projectionDefinition
  const initial = { shell: false, webSearch: false, wolfram: false, availability: {} }
  const next = definition.apply(initial, {
    type: 'chat-mode/tools',
    data: { shell: true, webSearch: true },
  })
  assert.deepEqual(next, { shell: true, webSearch: true, wolfram: false, availability: {} })
  const available = definition.apply(next, {
    type: 'chat-mode/availability',
    data: { availability: { wolfram: true } },
  })
  assert.deepEqual(available.availability, { wolfram: true })
  assert.deepEqual(definition.wire.view(available), {
    shell: true,
    webSearch: true,
    wolfram: false,
    availability: { wolfram: true },
  })
  assert.deepEqual(definition.stateSchema.parse({ shell: true, webSearch: false }), {
    shell: true,
    webSearch: false,
    wolfram: false,
    availability: {},
  })
  assert.throws(() => definition.stateSchema.parse(null))
  assert.throws(() => definition.stateSchema.parse({ shell: 'yes', webSearch: false }))
  assert.throws(() => definition.stateSchema.parse({ shell: false, webSearch: false, availability: { wolfram: 'yes' } }))

  // An old checkpoint must replay like a full replay: the normalized cached
  // state plus later events equals folding every event from the beginning.
  const oldCheckpoint = definition.stateSchema.parse({ shell: true, webSearch: false })
  const later = { type: 'chat-mode/availability', data: { availability: { wolfram: true } } }
  assert.deepEqual(
    definition.apply(definition.stateSchema.parse(oldCheckpoint), later),
    definition.apply(
      definition.apply(
        definition.apply(initial, { type: 'chat-mode/tools', data: { shell: true } }),
        { type: 'chat-mode/tools', data: { shell: true, webSearch: false } },
      ),
      later,
    ),
  )

  assert.equal(definition.apply(initial, { type: 'unrelated/event' }), initial, 'unrelated events preserve the reference')
}

// 5. `/permission` refuses full access and accepts the two allowed presets.
{
  const h = await boot()
  h.handlers.get('agent/created')({ agent: h.agent, source: 'startup' })
  const permission = command(h.commands, 'permission')
  const refused = permission.handler({ agent: h.agent, rawInput: 'danger-full-access' })
  assert.equal(refused.kind, 'error')
  assert.deepEqual(h.permissionSets, ['read-only'], 'refusal must not change the permission')
  const accepted = permission.handler({ agent: h.agent, rawInput: 'workspace-write' })
  assert.equal(accepted.kind, 'success')
  assert.deepEqual(h.permissionSets, ['read-only', 'workspace-write'])
}

// 6. During an open Turn the choice stays pending until the next accepted pre-step.
{
  const h = await boot({ openTurn: true })
  h.handlers.get('agent/created')({ agent: h.agent, source: 'startup' })
  await flush()
  const tools = command(h.commands, 'chat-tools')
  const queued = tools.handler({ agent: h.agent, rawInput: 'mode both' })
  assert.equal(queued.kind, 'success')
  assert.match(queued.text, /applies from the next step/u)
  assert.equal(h.events.some(event => event.type === 'chat-mode/tools'), false, 'no append while the Turn is open')
  await h.handlers.get('agent/pre-step')(
    { agent: h.agent, signal: new AbortController().signal },
    async () => ({ kind: 'enter' }),
  )
  assert.deepEqual(h.events.at(-1), {
    type: 'chat-mode/tools',
    data: { shell: true, webSearch: true, wolfram: false },
  })
}

// 7. The pre-execute guard denies a disabled gated tool and allows an enabled one.
{
  const h = await boot()
  h.handlers.get('agent/created')({ agent: h.agent, source: 'startup' })
  const guard = h.handlers.get('tools/pre-execute')
  const denied = await guard({ agent: h.agent, name: 'bash' }, async () => ({ kind: 'allow' }))
  assert.equal(denied.kind, 'deny')
  assert.match(denied.reason, /持久终端/u)
  const tools = command(h.commands, 'chat-tools')
  tools.handler({ agent: h.agent, rawInput: 'mode shell' })
  const allowed = await guard({ agent: h.agent, name: 'bash' }, async () => ({ kind: 'allow' }))
  assert.equal(allowed.kind, 'allow')
  const webDenied = await guard({ agent: h.agent, name: 'web_search' }, async () => ({ kind: 'allow' }))
  assert.equal(webDenied.kind, 'deny')
}

// 8. The creation listener is prepend, and a late tool registration is caught by tools/change.
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

// 9. Switching an already-created Agent to Chat applies the restriction from
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

// 10. Wolfram tools appear: the pack is discovered, denied by default, exposed
// through availability, and gated/enabled as one unit.
{
  const h = await boot()
  h.handlers.get('agent/created')({ agent: h.agent, source: 'startup' })
  await flush()
  assert.deepEqual(h.restrictions[0].filter, { deny: ['bash', 'web_search'] })

  h.registerTool(WOLFRAM_EVALUATOR)
  h.registerTool(WOLFRAM_CONTEXT)
  h.handlers.get('tools/change')()
  assert.deepEqual(h.restrictions.at(-1).filter, {
    deny: ['bash', 'web_search', WOLFRAM_EVALUATOR, WOLFRAM_CONTEXT],
  })
  await flush()
  assert.deepEqual(h.events.at(-1), {
    type: 'chat-mode/availability',
    data: { availability: { wolfram: true } },
  })

  const tools = command(h.commands, 'chat-tools')
  const guard = h.handlers.get('tools/pre-execute')
  const denied = await guard({ agent: h.agent, name: WOLFRAM_EVALUATOR }, async () => ({ kind: 'allow' }))
  assert.equal(denied.kind, 'deny')
  assert.match(denied.reason, /Wolfram/u)

  const enabled = tools.handler({ agent: h.agent, rawInput: 'wolfram on' })
  assert.equal(enabled.kind, 'success')
  assert.deepEqual(h.restrictions.at(-1).filter, { deny: ['bash', 'web_search'] })
  assert.deepEqual(h.events.at(-1), {
    type: 'chat-mode/tools',
    data: { shell: false, webSearch: false, wolfram: true },
  })
  const allowed = await guard({ agent: h.agent, name: WOLFRAM_EVALUATOR }, async () => ({ kind: 'allow' }))
  assert.equal(allowed.kind, 'allow')
  assert.match(h.variables.get('chat_tool_guidance')({ agent: h.agent }), /Wolfram 工具/u)
  assert.match(h.variables.get('chat_tool_guidance')({ agent: h.agent }), /wolfram-\*/u)

  const disabled = tools.handler({ agent: h.agent, rawInput: 'wolfram off' })
  assert.equal(disabled.kind, 'success')
  assert.equal(h.variables.get('chat_tool_guidance')({ agent: h.agent }), '')
  assert.deepEqual(h.restrictions.at(-1).filter, {
    deny: ['bash', 'web_search', WOLFRAM_EVALUATOR, WOLFRAM_CONTEXT],
  })
}

// 11. Wolfram tools disappear: availability flips back and the next restriction
// drops the now-unknown names instead of throwing.
{
  const h = await boot({ tools: ['bash', 'web_search', WOLFRAM_EVALUATOR] })
  h.handlers.get('agent/created')({ agent: h.agent, source: 'startup' })
  await flush()
  assert.deepEqual(h.restrictions[0].filter, { deny: ['bash', 'web_search', WOLFRAM_EVALUATOR] })
  assert.deepEqual(h.events.at(-1), {
    type: 'chat-mode/availability',
    data: { availability: { wolfram: true } },
  })

  h.removeTool(WOLFRAM_EVALUATOR)
  h.handlers.get('tools/change')()
  assert.deepEqual(h.restrictions.at(-1).filter, { deny: ['bash', 'web_search'] })
  await flush()
  assert.deepEqual(h.events.at(-1), {
    type: 'chat-mode/availability',
    data: { availability: { wolfram: false } },
  })
  const tools = command(h.commands, 'chat-tools')
  const rejected = tools.handler({ agent: h.agent, rawInput: 'wolfram on' })
  assert.equal(rejected.kind, 'error')
  assert.match(rejected.text, /not available/u)
}

// 12. Switching away from Chat disposes the restriction and stops replays.
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

console.log('chat-mode preset: all logic checks passed')
