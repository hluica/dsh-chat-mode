/**
 * Smoke test for the browser half.
 *
 * Loads `client.js` under a tiny module-loader / React / primitives stub and
 * asserts the slot registration, the chat-only branch, and the two dropdown
 * item sets. It does not emulate DSH's real popup shell; the shipped
 * `PermissionSelect` uses the same `Menu` contract, and the live GUI check is
 * still part of acceptance.
 */
import { strict as assert } from 'node:assert'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

let loaded
globalThis.window = {
  __ModuleLoader__: {
    load({ id, factory }) {
      loaded = { id, factory }
    },
  },
}

await import(pathToFileURL(join(root, 'client.js')).href)
assert.equal(loaded.id, '@local/dsh-chat-mode')

const React = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useEffect: () => {},
  useState: initial => [initial, () => {}],
}

/** Marker components; the real Menu renders the popup. */
function Menu() {}
function Chevron() {}

const module = loaded.factory((name) => {
  if (name === 'react') return React
  if (name === '@deepseek-ai/dsh-client-ui-primitives') {
    return { Menu, IconChevronDownOutlineRegular: Chevron }
  }
  throw new Error(`unexpected require(${JSON.stringify(name)})`)
})

assert.deepEqual(module.inject, ['slots', 'sessions', 'locale'])

const dictionary = {}
const styles = []
const slot = {}
const ctx = {
  effect: callback => { callback(); return () => {} },
  locale: {
    register(namespace, dictionaries) {
      dictionary[namespace] = dictionaries
      return () => {}
    },
  },
  slots: {
    inject(_name, callback) { callback(); return () => {} },
    register(options, component) {
      slot.options = options
      slot.component = component
      return () => {}
    },
  },
  sessions: {
    binding() {
      return { session: { command: async () => ({ ok: true, value: { matched: true } }) } }
    },
  },
}

globalThis.document = {
  createElement: () => ({ textContent: '', remove() {} }),
  head: { append: element => styles.push(element) },
  body: { dataset: {} },
}

module.apply(ctx)

assert.equal(slot.options.name, 'conversation.input.left')
assert.equal(slot.options.id, 'chat-mode-controls')
assert.equal(slot.options.locale, 'chatMode')
assert.equal(typeof slot.component, 'function')
assert.ok(dictionary.chatMode?.zh?.['permission.trigger'], 'zh dictionary registered')
assert.ok(dictionary.chatMode?.en?.['permission.trigger'], 'en dictionary registered')
assert.equal(styles.length, 1, 'style element injected')

const t = (key, args) => args === undefined ? key : `${key}(${JSON.stringify(args)})`

/** Render one session with the supplied preset and projections. */
function render({ preset = 'chat', permission = 'read-only', tools = { shell: false, webSearch: false } } = {}) {
  return slot.component({
    sessionId: 's1',
    useSessions: selector => selector({
      byId: { s1: { projectionValues: { agentPreset: preset } } },
    }),
    useProjection: key => key === 'permissions' ? { currentValue: permission } : tools,
    locked: false,
    runCommand: async () => {},
    t,
  })
}

const chat = render()
assert.equal(chat.type, 'span')
assert.equal(chat.children.length, 2, 'permission and tools menus')
const permissionMenu = chat.children[0]
const toolsMenu = chat.children[1]
assert.equal(permissionMenu.type, Menu)
assert.equal(toolsMenu.type, Menu)
assert.deepEqual(permissionMenu.props.items.map(item => item.id), ['read-only', 'workspace-write'])
assert.equal(permissionMenu.props.selectedId, 'read-only')
assert.deepEqual(toolsMenu.props.items.map(item => item.id), ['off', 'shell', 'search', 'both'])
assert.equal(toolsMenu.props.selectedId, 'off')
assert.equal(permissionMenu.props.anchor.type, 'button')
assert.match(permissionMenu.props.anchor.children[0].children[0], /permission\.trigger/u)

const shellTools = render({ tools: { shell: true, webSearch: false } })
assert.equal(shellTools.children[1].props.selectedId, 'shell')

const nonChat = render({ preset: 'standard' })
assert.equal(nonChat, null, 'non-chat sessions render nothing')

console.log('chat-mode client: all smoke checks passed')
