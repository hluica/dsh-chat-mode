/**
 * Smoke test for the browser half.
 *
 * Loads `client.js` under a tiny module-loader / React / primitives stub and
 * asserts the slot registrations, the chat-only branch, the permission
 * single-select, the built-in tools multi-select, the dynamic-item helpers, and
 * the settings page registration. It does not emulate DSH's real popup shell;
 * the live GUI check is still part of acceptance.
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
const registrations = {}
const ctx = {
  effect: callback => { callback(); return () => {} },
  locale: {
    register(namespace, dictionaries) {
      dictionary[namespace] = dictionaries
      return () => {}
    },
    bind(namespace) {
      return (key, args) => (args === undefined
        ? `${namespace}.${key}`
        : `${namespace}.${key}(${JSON.stringify(args)})`)
    },
    subscribe() { return () => {} },
    getSnapshot() { return { revision: 0 } },
  },
  slots: {
    inject(_name, callback) { callback(); return () => {} },
    register(options, component) {
      registrations[options.name] = { options, component }
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

// Composer control registration.
const composer = registrations['conversation.input.left']
assert.ok(composer, 'composer slot registered')
assert.equal(composer.options.id, 'chat-mode-controls')
assert.equal(composer.options.locale, 'chatMode')
assert.equal(typeof composer.component, 'function')

// Settings page sits between the two existing pages.
const section = registrations['settings.section']
assert.ok(section, 'settings section registered')
assert.equal(section.options.id, 'chat-mode-tools')
assert.equal(section.options.order, 21.5)
assert.equal(section.options.locale, 'chatMode')
assert.equal(typeof section.component, 'function')
const sectionIcon = registrations['settings.section.icon']
assert.ok(sectionIcon, 'settings navigation icon registered')
assert.equal(sectionIcon.options.id, 'chat-mode-tools')
assert.equal(typeof sectionIcon.component, 'function')

assert.ok(dictionary.chatMode?.zh?.['permission.trigger'], 'zh dictionary registered')
assert.ok(dictionary.chatMode?.en?.['permission.trigger'], 'en dictionary registered')
assert.equal(dictionary.chatMode.zh['settings.nav'], 'Chat Mode工具配置')
assert.equal(dictionary.chatMode.zh['settings.hide'], '隐藏')
assert.equal(dictionary.chatMode.zh['settings.submit'], '提交')
assert.equal(dictionary.chatMode.zh['settings.discard'], '放弃更改')
assert.equal(styles.length, 1, 'style element injected')

const t = (key, args) => args === undefined ? key : `${key}(${JSON.stringify(args)})`

// The settings page's initial render (the hook stub keeps the initial state:
// loading, no configuration, candidates not loaded). This catches malformed
// element trees without emulating the Host API.
const settingsInitial = section.component({
  t,
  localeFace: { subscribe: () => () => {}, getSnapshot: () => ({ revision: 0 }) },
  api: {
    loadConfig: async () => ({ config: { version: 1, tools: [] }, custom: [], path: '', error: null }),
    loadCandidates: async () => ({ tools: [] }),
    addTool: async () => ({}),
    updateTool: async () => ({}),
  },
})
assert.equal(settingsInitial.type, 'section')
assert.equal(settingsInitial.props.className, 'dsh-chat-settings')
const settingsTitle = settingsInitial.children.find(child => child?.props?.className === 'dsh-chat-settings-title')
assert.equal(settingsTitle.children[0], 'settings.title')
const commands = []

/** Render one session with the supplied preset and projections. */
function render({
  preset = 'chat',
  permission = 'read-only',
  tools = { shell: false, webSearch: false, custom: {} },
} = {}) {
  return composer.component({
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

// Tools: multi-select; the default menu has exactly the two built-in items.
assert.deepEqual(toolsMenu.props.items.map(item => item.id), ['shell', 'search'])
assert.deepEqual(toolsMenu.props.selectedIds, [])
assert.equal(toolsMenu.props.selectedId, undefined)
assert.ok(toolsMenu.props.items.every(item => item.icon !== undefined), 'tool items carry icons')
assert.ok(triggerIcon(toolsMenu.props.anchor) !== undefined, 'tools trigger carries an icon')
assert.match(triggerLabel(toolsMenu.props.anchor).children[0], /tools\.trigger/u)

// Tool labels use the persistent-terminal wording; the trigger joins the
// selected item labels instead of maintaining fixed combination strings.
assert.equal(dictionary.chatMode.zh['tools.shell'], '持久终端')
assert.equal(dictionary.chatMode.zh['tools.search'], '联网搜索')
assert.equal(dictionary.chatMode.zh['tools.off'], '全部关闭')

// Selected ids derive from the effective state.
const shellTools = render({ tools: { shell: true, webSearch: false, custom: {} } })
assert.deepEqual(shellTools.children[1].props.selectedIds, ['shell'])
const webTools = render({ tools: { shell: false, webSearch: true, custom: {} } })
assert.deepEqual(webTools.children[1].props.selectedIds, ['search'])
const bothTools = render({ tools: { shell: true, webSearch: true, custom: {} } })
assert.deepEqual(bothTools.children[1].props.selectedIds, ['shell', 'search'])
assert.equal(triggerLabel(bothTools.children[1].props.anchor).children[0], 'tools.trigger({"value":"tools.shell + tools.search"})')

// The availability snapshot filters the built-in table plus the custom packs;
// hidden/unavailable packs never reach the menu.
assert.equal(typeof module.visibleToolItems, 'function', 'availability filter is exported')
assert.deepEqual(module.visibleToolItems({ custom: [] }).map(item => item.id), ['shell', 'search'])
assert.deepEqual(
  module.visibleToolItems({ custom: [{ id: 'wolfram', label: 'Wolfram', icon: 'wolfram', available: true }] })
    .map(item => item.id),
  ['shell', 'search', 'wolfram'],
)
assert.deepEqual(
  module.visibleToolItems({ custom: [{ id: 'pack-x', label: 'X', icon: 'default', available: false }] })
    .map(item => item.id),
  ['shell', 'search'],
)
assert.ok(module.visibleToolItems({ custom: [{ id: 'wolfram', label: 'Wolfram', icon: 'wolfram', available: true }] })
  .find(item => item.id === 'wolfram').icon !== undefined)

// Pure helpers shared by the composer and the settings page.
const customItems = module.visibleToolItems({
  custom: [{ id: 'wolfram', label: 'Wolfram', icon: 'wolfram', available: true }],
})
assert.deepEqual(module.selectedToolIds(customItems, {
  shell: false,
  webSearch: false,
  custom: { wolfram: true },
}), ['wolfram'])
const wolframItem = customItems.find(item => item.id === 'wolfram')
assert.equal(module.toolCommand(wolframItem, true), '/chat-tools wolfram on')
assert.equal(module.toolCommand(customItems[0], false), '/chat-tools shell off')
assert.equal(module.sameTools(
  { shell: false, webSearch: false, custom: {} },
  { shell: false, webSearch: false, custom: {} },
), true)
assert.equal(module.sameTools(
  { shell: false, webSearch: false, custom: { wolfram: true } },
  { shell: false, webSearch: false, custom: {} },
), false)

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
