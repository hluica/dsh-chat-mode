/**
 * Logic-level tests for the preset-scope chat-mode plugin.
 *
 * These exercise the plugin's own decisions — permission pinning, tool
 * restrictions, command grammar, and the projection fold — against stubbed
 * Cordis services. They do not replace a live Web-session check; they catch the
 * regressions that are cheap to catch outside the Host.
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
  let current = initialCurrent
  let logged = { shell: false, webSearch: false }
  const restrictions = []
  const handlers = new Map()
  let projectionDefinition
  let turnOpen = openTurn

  const session = {
    append(type, data) {
      events.push({ type, data })
      if (type === 'chat-mode/tools') logged = { shell: data.shell, webSearch: data.webSearch }
      return { type, data }
    },
  }

  const available = new Set(availableTools)
  const tools = {
    get(name) { return available.has(name) ? { name } : undefined },
    restrict(filter) {
      restrictions.push({ kind: 'restrict', filter })
      return () => { restrictions.push({ kind: 'lift', filter }) }
    },
  }

  const agent = {
    session,
    ctx: {
      tools,
      effect(callback, label) {
        const cleanup = callback()
        return () => { cleanup?.() ; void label }
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
    },
    on(event, handler) {
      handlers.set(event, handler)
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
    get projectionDefinition() { return projectionDefinition },
    setTurnOpen(value) { turnOpen = value },
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

// 1. Fresh Agent: read-only permission and both advanced tools hidden.
{
  const h = await boot()
  h.handlers.get('agent/created')({ agent: h.agent, source: 'startup' })
  assert.deepEqual(h.permissionSets, ['read-only'], 'fresh chat should pin read-only')
  assert.equal(h.restrictions.length, 1, 'one restriction should be installed')
  assert.deepEqual(h.restrictions[0].filter, { deny: ['bash', 'web_search'] })
  assert.ok(command(h.commands, 'chat-tools'), '/chat-tools should be registered in the preset scope')
  assert.ok(command(h.agentCommands, 'permission'), '/permission should be registered on the Agent scope')
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
  const tools = command(h.commands, 'chat-tools')
  const result = tools.handler({ agent: h.agent, rawInput: 'mode shell' })
  assert.equal(result.kind, 'success')
  assert.deepEqual(h.events.at(-1), {
    type: 'chat-mode/tools',
    data: { shell: true, webSearch: false },
  })
  assert.deepEqual(h.restrictions.at(-2), { kind: 'lift', filter: { deny: ['bash', 'web_search'] } })
  assert.deepEqual(h.restrictions.at(-1), { kind: 'restrict', filter: { deny: ['web_search'] } })
}

// 4. The projection fold and wire view carry only the two booleans.
{
  const h = await boot()
  const definition = h.projectionDefinition
  const next = definition.apply({ shell: false, webSearch: false }, {
    type: 'chat-mode/tools',
    data: { shell: true, webSearch: true },
  })
  assert.deepEqual(next, { shell: true, webSearch: true })
  assert.deepEqual(definition.wire.view(next), { shell: true, webSearch: true })
  assert.throws(() => definition.stateSchema.parse(null))
  assert.throws(() => definition.stateSchema.parse({ shell: 'yes', webSearch: false }))
}

// 5. `/permission` refuses full access and accepts the two allowed presets.
{
  const h = await boot()
  h.handlers.get('agent/created')({ agent: h.agent, source: 'startup' })
  const permission = command(h.agentCommands, 'permission')
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
    data: { shell: true, webSearch: true },
  })
}

// 7. The pre-execute guard denies a disabled gated tool and allows an enabled one.
{
  const h = await boot()
  h.handlers.get('agent/created')({ agent: h.agent, source: 'startup' })
  const guard = h.handlers.get('tools/pre-execute')
  const denied = await guard({ agent: h.agent, name: 'bash' }, async () => ({ kind: 'allow' }))
  assert.equal(denied.kind, 'deny')
  assert.match(denied.reason, /命令执行/u)
  const tools = command(h.commands, 'chat-tools')
  tools.handler({ agent: h.agent, rawInput: 'mode shell' })
  const allowed = await guard({ agent: h.agent, name: 'bash' }, async () => ({ kind: 'allow' }))
  assert.equal(allowed.kind, 'allow')
  const webDenied = await guard({ agent: h.agent, name: 'web_search' }, async () => ({ kind: 'allow' }))
  assert.equal(webDenied.kind, 'deny')
}

console.log('chat-mode preset: all logic checks passed')
