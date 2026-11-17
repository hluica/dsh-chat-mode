/**
 * Smoke test for the browser half.
 *
 * Loads `client.js` under a tiny module-loader / React / primitives stub and
 * asserts the slot registration, the chat-only branch, the permission
 * single-select, and the tools multi-select. It does not emulate DSH's real
 * popup shell; the shipped `PermissionSelect` uses the same `Menu` contract,
 * and the live GUI check is still part of acceptance.
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
function ReadOnlyIcon() {}
function WorkspaceIcon() {}
function ShellIcon() {}
function WebIcon() {}
function ToolsIcon() {}

const primitives = {
  Menu,
  IconChevronDownOutlineRegular: Chevron,
  PermissionIconReadOnlyRegular: ReadOnlyIcon,
  PermissionIconWorkspaceWriteRegular: WorkspaceIcon,
  IconCodeOutlineRegular: ShellIcon,
  IconGlobeOutlineRegular: WebIcon,
  IconSlidersTwoOutlineRegular: ToolsIcon,
}

const module = loaded.factory((name) => {
  if (name === 'react') return React
  if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitives
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
const commands = []

/** Render one session with the supplied preset and projections. */
function render({ preset = 'chat', permission = 'read-only', tools = { shell: false, webSearch: false } } = {}) {
  return slot.component({
    sessionId: 's1',
    useSessions: selector => selector({
      byId: { s1: { projectionValues: { agentPreset: preset } } },
    }),
    useProjection: key => key === 'permissions' ? { currentValue: permission } : tools,
    locked: false,
    runCommand: async (line) => {
      commands.push(line)
      return true
    },
    t,
  })
}

/** Find the label span inside one trigger button. */
function triggerLabel(anchor) {
  return anchor.children.find(child => child?.props?.className === 'dsh-chat-trigger-label')
}

/** Find the icon span inside one trigger button. */
function triggerIcon(anchor) {
  return anchor.children.find(child => child?.props?.className === 'dsh-chat-trigger-icon')
}

const chat = render()
assert.equal(chat.type, 'span')
assert.equal(chat.props.className, 'dsh-chat-controls')
assert.equal(chat.children.length, 2, 'permission and tools menus')
const permissionMenu = chat.children[0]
const toolsMenu = chat.children[1]
assert.equal(permissionMenu.type, Menu)
assert.equal(toolsMenu.type, Menu)

// Permission: single-select, two items, both with icons.
assert.deepEqual(permissionMenu.props.items.map(item => item.id), ['read-only', 'workspace-write'])
assert.equal(permissionMenu.props.selectedId, 'read-only')
assert.ok(permissionMenu.props.items.every(item => item.icon !== undefined), 'permission items carry icons')
assert.equal(permissionMenu.props.anchor.type, 'button')
assert.equal(permissionMenu.props.anchor.props.className, 'dsh-chat-trigger')
assert.ok(triggerIcon(permissionMenu.props.anchor) !== undefined, 'permission trigger carries an icon')
assert.match(triggerLabel(permissionMenu.props.anchor).children[0], /permission\.trigger/u)

// Tools: multi-select, exactly two items, each with an icon.
assert.deepEqual(toolsMenu.props.items.map(item => item.id), ['shell', 'search'])
assert.deepEqual(toolsMenu.props.selectedIds, [])
assert.equal(toolsMenu.props.selectedId, undefined)
assert.ok(toolsMenu.props.items.every(item => item.icon !== undefined), 'tool items carry icons')
assert.ok(triggerIcon(toolsMenu.props.anchor) !== undefined, 'tools trigger carries an icon')
assert.match(triggerLabel(toolsMenu.props.anchor).children[0], /tools\.trigger/u)

// Tool labels use the persistent-terminal wording.
assert.equal(dictionary.chatMode.zh['tools.shell'], '持久终端')
assert.equal(dictionary.chatMode.zh['tools.search'], '联网搜索')
assert.equal(dictionary.chatMode.zh['tools.both'], '持久终端 + 联网')

// Selected ids derive from the effective state.
const shellTools = render({ tools: { shell: true, webSearch: false } })
assert.deepEqual(shellTools.children[1].props.selectedIds, ['shell'])
const webTools = render({ tools: { shell: false, webSearch: true } })
assert.deepEqual(webTools.children[1].props.selectedIds, ['search'])
const bothTools = render({ tools: { shell: true, webSearch: true } })
assert.deepEqual(bothTools.children[1].props.selectedIds, ['shell', 'search'])

// Clicking a tool item toggles it without closing the menu.
commands.length = 0
toolsMenu.props.onSelect('shell')
assert.deepEqual(commands, ['/chat-tools shell on'])
commands.length = 0
shellTools.children[1].props.onSelect('shell')
assert.deepEqual(commands, ['/chat-tools shell off'])
commands.length = 0
webTools.children[1].props.onSelect('search')
assert.deepEqual(commands, ['/chat-tools search off'])

// Permission picks close the menu and submit the single value.
commands.length = 0
permissionMenu.props.onSelect('workspace-write')
assert.deepEqual(commands, ['/permission workspace-write'])

// Non-chat sessions render nothing.
const nonChat = render({ preset: 'standard' })
assert.equal(nonChat, null, 'non-chat sessions render nothing')

console.log('chat-mode client: all smoke checks passed')
