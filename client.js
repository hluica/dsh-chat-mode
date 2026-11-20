/**
 * Browser half of chat mode.
 *
 * It adds two compact dropdowns to the composer tool row for sessions that
 * selected the `chat` Agent preset:
 *
 * - Permission: read-only / workspace-write (single select). The Agent-scoped
 *   `/permission` command in `preset.js` is the authority; the shipped
 *   permission control is hidden for chat sessions so "Full access" is not
 *   offered here.
 * - Tools: a multi-select menu driven by two sources. “持久终端” and
 *   “联网搜索” are built into this file; every other item comes from the
 *   owner-only `/dsh-chat-mode/api/state` route, which reads the custom pack
 *   configuration in `$DSH_HOME/dsh-chat-mode/tools.json`. Wolfram is the
 *   default custom pack and keeps its star icon; other packs use the shared
 *   default icon. The menu stays open while toggling, and hidden packs never
 *   reach it.
 *
 * It also adds the “Chat Mode工具配置” settings page between the shipped
 * “Agent 预设文本” (order 21) and “Wolfram MCP 设置” (order 22):
 *
 * - display every custom pack's menu name, actual tools, availability, hidden
 *   state, and `chat_tool_guidance` text;
 * - add a pack from the non-builtin tool registry (multi-select, optional
 *   guidance);
 * - hide/show a pack without deleting its configuration;
 * - edit every pack's guidance with per-pack “提交” / “放弃更改” actions.
 *
 * The body-level `data-dsh-chat-mode` attribute scopes the stylesheet rule that
 * hides the shipped permission seat; non-chat sessions never see it.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-chat-mode',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useState } = React
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    const Menu = primitives.Menu
    const Chevron = primitives.IconChevronDownOutlineRegular
    const ReadOnlyIcon = primitives.PermissionIconReadOnlyRegular
    const WorkspaceIcon = primitives.PermissionIconWorkspaceWriteRegular
    const ShellIcon = primitives.IconCodeOutlineRegular
    const WebIcon = primitives.IconGlobeOutlineRegular
    const ToolsIcon = primitives.IconSlidersTwoOutlineRegular

    /** Locale dictionary namespace owned by this plugin. */
    const NS = 'chatMode'

    /** Owner-only Host route polled by the composer and used by settings. */
    const API = '/dsh-chat-mode/api'

    /** Settings section identity and position between the two existing pages. */
    const SETTINGS_SECTION_ID = 'chat-mode-tools'
    const SETTINGS_SECTION_ORDER = 21.5

    /**
     * The two built-in tool items. They are fixed in code and always visible;
     * custom items are appended from the Host availability snapshot.
     */
    const BUILTIN_TOOL_ITEMS = [
      { id: 'shell', kind: 'builtin', stateKey: 'shell', commandId: 'shell', labelKey: 'tools.shell', icon: ShellIcon },
      { id: 'search', kind: 'builtin', stateKey: 'webSearch', commandId: 'search', labelKey: 'tools.search', icon: WebIcon },
    ]

    /**
     * Wolfram mark copied from `@local/dsh-wolfram-mcp/client.js`
     * (`WolframMcpIcon`). It is a plain currentColor SVG so the plugin needs no
     * additional client inject entry.
     */
    function WolframMcpIcon({ size = 16, active = false }) {
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        'aria-hidden': true,
        focusable: false,
        style: { display: 'block', opacity: active ? 1 : 0.72 },
      },
        h('path', {
          d: 'M8.00 1.00 L9.26 4.95 L12.95 3.05 L11.05 6.74 L15.00 8.00 L11.05 9.26 L12.95 12.95 L9.26 11.05 L8.00 15.00 L6.74 11.05 L3.05 12.95 L4.95 9.26 L1.00 8.00 L4.95 6.74 L3.05 3.05 L6.74 4.95 Z M8.00 6.40 L8.53 7.47 L9.60 8.00 L8.53 8.53 L8.00 9.60 L7.47 8.53 L6.40 8.00 L7.47 7.47 Z',
          fill: 'currentColor',
          fillRule: 'evenodd',
          clipRule: 'evenodd',
        }),
      )
    }

    /**
     * Map the configuration's icon key to the renderer owned by this file.
     * Unknown keys fall back to the shared default, so a hand-edited file can
     * never name an arbitrary renderer or execute code.
     * @param {unknown} icon - configuration value.
     * @returns {Function | undefined}
     */
    function iconFor(icon) {
      if (icon === 'wolfram') return WolframMcpIcon
      return ToolsIcon
    }

    /** The empty tool selection. */
    function emptyTools() {
      return { shell: false, webSearch: false, custom: {} }
    }

    /** Normalize the projection's custom map for the Client side. */
    function normalizeCustom(value) {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
      const custom = {}
      for (const [id, flag] of Object.entries(value)) custom[id] = flag === true
      return custom
    }

    /** Whether two tool selections are equivalent. */
    function sameTools(left, right) {
      if ((left?.shell === true) !== (right?.shell === true)) return false
      if ((left?.webSearch === true) !== (right?.webSearch === true)) return false
      const leftCustom = normalizeCustom(left?.custom)
      const rightCustom = normalizeCustom(right?.custom)
      const keys = new Set([...Object.keys(leftCustom), ...Object.keys(rightCustom)])
      for (const key of keys) {
        if (leftCustom[key] !== rightCustom[key]) return false
      }
      return true
    }

    /** Selected item ids for one visible item list and one selection. */
    function selectedToolIds(items, tools) {
      return items
        .filter((item) => (item.kind === 'builtin'
          ? tools?.[item.stateKey] === true
          : tools?.custom?.[item.id] === true))
        .map((item) => item.id)
    }

    /** The slash command that toggles one menu item. */
    function toolCommand(item, enabled) {
      return `/chat-tools ${item.commandId} ${enabled ? 'on' : 'off'}`
    }

    /**
     * Merge the built-in items with the available custom items from the Host.
     * @param {{ custom?: Array<Record<string, unknown>> } | undefined} availability
     * @returns {Array<Record<string, unknown>>}
     */
    function visibleToolItems(availability) {
      const custom = Array.isArray(availability?.custom) ? availability.custom : []
      const items = custom
        .filter((pack) => pack?.available === true)
        .map((pack) => ({
          id: pack.id,
          kind: 'custom',
          commandId: pack.id,
          label: typeof pack.label === 'string' && pack.label !== '' ? pack.label : pack.id,
          icon: iconFor(pack.icon),
          rawIcon: pack.icon,
        }))
      return [...BUILTIN_TOOL_ITEMS, ...items]
    }

    /** Chinese copy for the dropdowns and the settings page. */
    const zh = {
      'permission.trigger': '权限：{value}',
      'permission.readOnly': '仅可查看',
      'permission.workspaceWrite': '工作区内修改',
      'permission.unavailable': '不可用',
      'permission.title': '选择对话模式的权限',
      'tools.trigger': '工具：{value}',
      'tools.off': '全部关闭',
      'tools.shell': '持久终端',
      'tools.search': '联网搜索',
      'tools.wolfram': 'Wolfram',
      'tools.title': '启用或关闭对话模式的高级工具（可多选）',
      'settings.nav': 'Chat Mode工具配置',
      'settings.title': 'Chat Mode工具配置',
      'settings.intro': '管理内置工具之外的可选工具包：显示、新增与隐藏菜单项，并编辑每个菜单项注入系统提示词的 guidance。内置工具不受本页控制。',
      'settings.current': '当前工具配置',
      'settings.empty': '还没有自定义工具配置。',
      'settings.addTitle': '新增工具配置',
      'settings.addHint': '选择一个或多个工具；它们会作为一个菜单项出现在输入框左侧的“工具”菜单中。',
      'settings.menuName': '菜单名称',
      'settings.menuNamePlaceholder': '例如：工作目录',
      'settings.guidance': 'chat-tool-guidance 提示词',
      'settings.guidanceHint': '可留空；留空时不向系统提示词注入内容。修改后点击“提交”保存。',
      'settings.selectTools': '选择工具',
      'settings.refresh': '刷新工具列表',
      'settings.refreshing': '正在刷新…',
      'settings.loading': '正在加载…',
      'settings.noCandidates': '没有可添加的工具。',
      'settings.configured': '已配置',
      'settings.available': '可用',
      'settings.unavailable': '不可用',
      'settings.hidden': '已隐藏',
      'settings.hide': '隐藏',
      'settings.show': '显示',
      'settings.hiddenHint': '隐藏只会从“工具”菜单移除该菜单项，并暂停其工具与提示词；配置仍保留，可随时重新显示。',
      'settings.actualTools': '实际工具名',
      'settings.configPath': '配置文件',
      'settings.configPathUnknown': '不可用',
      'settings.configError': '配置文件错误',
      'settings.configEditable': '也可以直接编辑该文件；保存后下一轮生效。',
      'settings.requestFailed': '请求失败',
      'settings.saveFailed': '保存失败',
      'settings.saved': '已保存。',
      'settings.hiddenNotice': '已隐藏。',
      'settings.shownNotice': '已显示。',
      'settings.submit': '提交',
      'settings.discard': '放弃更改',
      'settings.add': '添加并生效',
      'settings.adding': '正在保存…',
      'settings.selectedCount': '已选 {n} 个',
      'settings.builtinNote': '内置工具（read、read_image、glob、grep、web_fetch、ask_user_question、持久终端、联网搜索）由代码固定，不在此页管理。',
      'settings.newPackOff': '新配置默认关闭；保存后请在输入框左侧的“工具”菜单中启用。',
      'settings.unsaved': '有未提交的更改',
    }

    /** English copy for the dropdowns and the settings page. */
    const en = {
      'permission.trigger': 'Permission: {value}',
      'permission.readOnly': 'Read Only',
      'permission.workspaceWrite': 'Workspace',
      'permission.unavailable': 'Unavailable',
      'permission.title': 'Choose the chat-mode permission',
      'tools.trigger': 'Tools: {value}',
      'tools.off': 'Off',
      'tools.shell': 'Persistent shell',
      'tools.search': 'Web search',
      'tools.wolfram': 'Wolfram',
      'tools.title': 'Enable or disable chat-mode advanced tools (multi-select)',
      'settings.nav': 'Chat Mode tools',
      'settings.title': 'Chat Mode tool configuration',
      'settings.intro': 'Manage optional tool packs beyond the built-in tools: show, add, and hide menu items, and edit the guidance each item injects into the system prompt. Built-in tools are not controlled here.',
      'settings.current': 'Current tool configuration',
      'settings.empty': 'No custom tool packs yet.',
      'settings.addTitle': 'Add a tool pack',
      'settings.addHint': 'Pick one or more tools; they become one item in the Tools menu left of the composer.',
      'settings.menuName': 'Menu name',
      'settings.menuNamePlaceholder': 'e.g. Working directory',
      'settings.guidance': 'chat-tool-guidance prompt',
      'settings.guidanceHint': 'Optional; when empty, nothing is added to the system prompt. Click “Submit” to save edits.',
      'settings.selectTools': 'Choose tools',
      'settings.refresh': 'Refresh tool list',
      'settings.refreshing': 'Refreshing…',
      'settings.loading': 'Loading…',
      'settings.noCandidates': 'No tools can be added.',
      'settings.configured': 'Configured',
      'settings.available': 'Available',
      'settings.unavailable': 'Unavailable',
      'settings.hidden': 'Hidden',
      'settings.hide': 'Hide',
      'settings.show': 'Show',
      'settings.hiddenHint': 'Hiding only removes the item from the Tools menu and suspends its tools and prompt; the configuration stays and can be shown again.',
      'settings.actualTools': 'Actual tools',
      'settings.configPath': 'Configuration file',
      'settings.configPathUnknown': 'Unavailable',
      'settings.configError': 'Configuration error',
      'settings.configEditable': 'You can also edit the file directly; changes apply on the next turn.',
      'settings.requestFailed': 'Request failed',
      'settings.saveFailed': 'Save failed',
      'settings.saved': 'Saved.',
      'settings.hiddenNotice': 'Hidden.',
      'settings.shownNotice': 'Shown.',
      'settings.submit': 'Submit',
      'settings.discard': 'Discard changes',
      'settings.add': 'Add and apply',
      'settings.adding': 'Saving…',
      'settings.selectedCount': '{n} selected',
      'settings.builtinNote': 'Built-in tools (read, read_image, glob, grep, web_fetch, ask_user_question, persistent shell, web search) are fixed in code and are not managed here.',
      'settings.newPackOff': 'New packs are off by default; enable one from the Tools menu left of the composer after saving.',
      'settings.unsaved': 'Unsaved changes',
    }

    /**
     * Trigger and menu-item styling plus the settings page. All colors come
     * from the host theme tokens; the shipped `Menu` owns the popup surface, so
     * only our trigger and the item icons/checks are styled here. The final
     * rule keeps hiding the shipped current-session permission seat for chat
     * sessions.
     */
    const STYLE_TEXT = `
.dsh-chat-controls { display: inline-flex; align-items: center; gap: 6px; }
.dsh-chat-trigger {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  max-width: 190px;
  padding: 0 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 65%, transparent);
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  line-height: 24px;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
}
.dsh-chat-trigger:hover:not(:disabled) {
  color: var(--dsw-alias-label-primary);
  border-color: var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
}
.dsh-chat-trigger:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}
.dsh-chat-trigger[data-active="true"] {
  color: var(--dsw-alias-brand-primary);
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 55%, var(--dsw-alias-border-l1));
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 8%, transparent);
}
.dsh-chat-trigger:disabled { cursor: default; opacity: 0.55; }
.dsh-chat-trigger-icon {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  opacity: 0.9;
}
.dsh-chat-trigger-icon > svg { display: block; width: 14px; height: 14px; }
.dsh-chat-trigger-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-chat-trigger-chevron {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 12px;
  height: 12px;
  opacity: 0.55;
  transition: transform 120ms ease;
}
.dsh-chat-trigger-chevron > svg { display: block; width: 12px; height: 12px; }
.dsh-chat-trigger[aria-expanded="true"] .dsh-chat-trigger-chevron { transform: rotate(180deg); }
@media (prefers-reduced-motion: reduce) {
  .dsh-chat-trigger, .dsh-chat-trigger-chevron { transition: none; }
}
.dsh-chat-settings { display: flex; flex-direction: column; gap: 16px; max-width: 820px; color: var(--dsw-alias-label-primary); }
.dsh-chat-settings-title { margin: 0; font-size: 18px; font-weight: 600; }
.dsh-chat-settings-intro { margin: 0; font-size: 13px; color: var(--dsw-alias-label-tertiary); line-height: 1.6; }
.dsh-chat-settings-meta { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
.dsh-chat-settings-group { display: flex; flex-direction: column; gap: 10px; }
.dsh-chat-settings-heading { margin: 0; font-size: 12px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--dsw-alias-label-tertiary); }
.dsh-chat-pack { display: flex; flex-direction: column; gap: 10px; padding: 12px 14px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); }
.dsh-chat-pack--hidden { opacity: .72; border-style: dashed; }
.dsh-chat-pack-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dsh-chat-pack-icon { display: inline-flex; flex: none; align-items: center; justify-content: center; width: 16px; height: 16px; }
.dsh-chat-pack-title { font-size: 14px; font-weight: 600; min-width: 0; overflow-wrap: anywhere; }
.dsh-chat-pack-id { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.dsh-chat-pack-action { margin-left: auto; }
.dsh-chat-pack-row { display: flex; gap: 8px; font-size: 12px; line-height: 1.55; }
.dsh-chat-pack-label { flex: 0 0 auto; color: var(--dsw-alias-label-tertiary); }
.dsh-chat-pack-tools { flex: 1; min-width: 0; overflow-wrap: anywhere; color: var(--dsw-alias-label-secondary); }
.dsh-chat-badge { font-size: 11px; line-height: 17px; padding: 0 7px; border-radius: 999px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); border: 1px solid var(--dsw-alias-border-l2); white-space: nowrap; }
.dsh-chat-badge--ok { border-color: var(--dsw-alias-state-success-primary); color: var(--dsw-alias-state-success-primary); }
.dsh-chat-badge--warn { border-color: var(--dsw-alias-state-warn-primary); color: var(--dsw-alias-state-warn-primary); }
.dsh-chat-field { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dsh-chat-field-label { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary); }
.dsh-chat-input, .dsh-chat-textarea { box-sizing: border-box; font: inherit; font-size: 12px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; padding: 6px 8px; min-width: 0; }
.dsh-chat-input { flex: 1; min-width: 160px; }
.dsh-chat-textarea { min-height: 96px; resize: vertical; line-height: 1.5; }
.dsh-chat-input:focus-visible, .dsh-chat-textarea:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dsh-chat-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.dsh-chat-button { appearance: none; border: 1px solid var(--dsw-alias-border-l2); background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; padding: 5px 12px; border-radius: 8px; cursor: pointer; }
.dsh-chat-button:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
.dsh-chat-button:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dsh-chat-button:disabled { opacity: .5; cursor: default; }
.dsh-chat-button--primary { border-color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-brand-primary); color: #fff; }
.dsh-chat-hint { margin: 0; font-size: 11px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); overflow-wrap: anywhere; }
.dsh-chat-alert { margin: 0; padding: 8px 10px; border: 1px solid var(--dsw-alias-state-error-primary); border-radius: 8px; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-state-error-primary); overflow-wrap: anywhere; }
.dsh-chat-notice { margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-state-success-primary); }
.dsh-chat-candidates-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dsh-chat-candidates { display: flex; flex-direction: column; gap: 4px; max-height: 320px; overflow: auto; padding: 8px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-base); }
.dsh-chat-candidate { display: flex; gap: 8px; align-items: flex-start; padding: 4px 6px; border-radius: 6px; font-size: 12px; cursor: pointer; }
.dsh-chat-candidate:hover { background: var(--dsw-alias-bg-layer-2); }
.dsh-chat-candidate--configured { opacity: .65; cursor: default; }
.dsh-chat-candidate-main { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; min-width: 0; }
.dsh-chat-candidate-name { overflow-wrap: anywhere; }
.dsh-chat-candidate-desc { flex: 1 1 100%; color: var(--dsw-alias-label-tertiary); line-height: 1.5; overflow-wrap: anywhere; }
body[data-dsh-chat-mode="1"] [data-slot="conversation.input.permission"] { display: none !important; }
`

    /** Render one icon component, tolerating a missing export in another DSH build. */
    function renderIcon(Component) {
      return Component === undefined ? undefined : h(Component)
    }

    /** Render one dropdown trigger button. */
    function trigger({ label, title, open, disabled, active, icon: iconComponent, onClick }) {
      return h('button', {
        type: 'button',
        className: 'dsh-chat-trigger',
        disabled,
        title,
        'aria-label': title,
        'aria-expanded': open ? 'true' : 'false',
        ...(active ? { 'data-active': 'true' } : {}),
        onClick,
      },
        iconComponent === undefined
          ? null
          : h('span', { className: 'dsh-chat-trigger-icon', 'aria-hidden': true }, h(iconComponent)),
        h('span', { className: 'dsh-chat-trigger-label' }, label),
        h('span', { className: 'dsh-chat-trigger-chevron', 'aria-hidden': true },
          Chevron === undefined ? '▾' : h(Chevron)),
      )
    }

    /**
     * Composer control for one chat session.
     * @param props - slot runtime props, the injected command writer, and locale.
     */
    function ChatModeControls({ sessionId, useSessions, useProjection, locked, runCommand, t }) {
      const preset = useSessions(state => state.byId[sessionId]?.projectionValues?.agentPreset)
      const selection = useProjection('permissions')
      const tools = useProjection('chatMode')
      const isChat = preset === 'chat'
      const [permissionOpen, setPermissionOpen] = useState(false)
      const [toolsOpen, setToolsOpen] = useState(false)
      const [pendingTools, setPendingTools] = useState(null)
      const [availability, setAvailability] = useState({ custom: [] })

      // Hide the shipped permission control only while a chat session is active.
      useEffect(() => {
        if (isChat) document.body.dataset.dshChatMode = '1'
        else delete document.body.dataset.dshChatMode
        return () => { delete document.body.dataset.dshChatMode }
      }, [isChat])

      // Dynamic availability is environment state owned by the Host tool
      // registry. The Session projection carries only the user's choice, so the
      // Client asks the owner-only route and polls it: no session event type is
      // invented, and an MCP registration/removal or a new custom pack is
      // reflected without a page reload. A failed request keeps the last
      // snapshot.
      useEffect(() => {
        if (!isChat) return undefined
        let cancelled = false
        let timer
        const refresh = async () => {
          try {
            const response = await fetch(`${API}/state`, { cache: 'no-store' })
            const payload = await response.json()
            if (!cancelled && payload?.ok === true) {
              setAvailability({ custom: Array.isArray(payload.result?.custom) ? payload.result.custom : [] })
            }
          } catch {
            // Keep the previous snapshot; the next poll retries.
          }
        }
        void refresh()
        timer = setInterval(refresh, 3000)
        return () => {
          cancelled = true
          if (timer !== undefined) clearInterval(timer)
        }
      }, [isChat, sessionId])

      const liveTools = tools === undefined
        ? emptyTools()
        : {
            shell: tools.shell === true,
            webSearch: tools.webSearch === true,
            custom: normalizeCustom(tools.custom),
          }
      const effectiveTools = pendingTools ?? liveTools
      const visibleItems = visibleToolItems(availability)

      // Keep the optimistic selection until the durable projection catches up.
      useEffect(() => {
        if (pendingTools === null) return
        if (sameTools(pendingTools, liveTools)) setPendingTools(null)
      }, [pendingTools, liveTools.shell, liveTools.webSearch, liveTools.custom])

      if (!isChat) return null

      const permissionValue = selection?.currentValue
      const permissionLabel = permissionValue === 'read-only'
        ? t('permission.readOnly')
        : permissionValue === 'workspace-write'
          ? t('permission.workspaceWrite')
          : (permissionValue ?? t('permission.unavailable'))
      const permissionIcon = permissionValue === 'read-only'
        ? ReadOnlyIcon
        : permissionValue === 'workspace-write'
          ? WorkspaceIcon
          : undefined
      const permissionItems = [
        { id: 'read-only', label: t('permission.readOnly'), ...(ReadOnlyIcon ? { icon: h(ReadOnlyIcon) } : {}) },
        { id: 'workspace-write', label: t('permission.workspaceWrite'), ...(WorkspaceIcon ? { icon: h(WorkspaceIcon) } : {}) },
      ]

      const selectedItems = visibleItems.filter((item) => (item.kind === 'builtin'
        ? effectiveTools[item.stateKey] === true
        : effectiveTools.custom[item.id] === true))
      const selectedTools = selectedItems.map(item => item.id)
      const toolsItems = visibleItems.map(item => ({
        id: item.id,
        label: item.kind === 'builtin' ? t(item.labelKey) : item.label,
        ...(item.icon ? { icon: h(item.icon) } : {}),
      }))
      const toolsLabel = selectedItems.length === 0
        ? t('tools.off')
        : selectedItems.map(item => (item.kind === 'builtin' ? t(item.labelKey) : item.label)).join(' + ')
      const toolsActive = selectedItems.length > 0

      const permissionDisabled = locked === true || selection === undefined
      const toolsDisabled = locked === true

      /** Toggle one visible item and submit the matching `/chat-tools` command. */
      const onToolSelect = (id) => {
        const item = visibleItems.find(entry => entry.id === id)
        if (item === undefined) return
        const next = {
          shell: effectiveTools.shell,
          webSearch: effectiveTools.webSearch,
          custom: { ...effectiveTools.custom },
        }
        let enabled
        if (item.kind === 'builtin') {
          next[item.stateKey] = !next[item.stateKey]
          enabled = next[item.stateKey]
        } else {
          next.custom[item.id] = !(next.custom[item.id] === true)
          enabled = next.custom[item.id]
        }
        setPendingTools(next)
        void runCommand(toolCommand(item, enabled))
          .then((ok) => { if (!ok) setPendingTools(null) })
      }

      return h('span', { className: 'dsh-chat-controls' },
        h(Menu, {
          open: permissionOpen,
          items: permissionItems,
          selectedId: permissionValue,
          selection: 'check',
          onSelect: (id) => {
            setPermissionOpen(false)
            if (id !== permissionValue) void runCommand(`/permission ${id}`)
          },
          onClose: () => { setPermissionOpen(false) },
          side: 'top',
          portal: true,
          anchor: trigger({
            label: t('permission.trigger', { value: permissionLabel }),
            title: t('permission.title'),
            open: permissionOpen,
            disabled: permissionDisabled,
            active: false,
            icon: permissionIcon,
            onClick: () => { if (!permissionDisabled) setPermissionOpen(!permissionOpen) },
          }),
        }),
        h(Menu, {
          open: toolsOpen,
          items: toolsItems,
          selectedIds: selectedTools,
          selection: 'check',
          onSelect: onToolSelect,
          onClose: () => { setToolsOpen(false) },
          side: 'top',
          portal: true,
          anchor: trigger({
            label: t('tools.trigger', { value: toolsLabel }),
            title: t('tools.title'),
            open: toolsOpen,
            disabled: toolsDisabled,
            active: toolsActive,
            icon: ToolsIcon,
            onClick: () => { if (!toolsDisabled) setToolsOpen(!toolsOpen) },
          }),
        }),
      )
    }

    /**
     * Call one owner-only API endpoint.
     * @param {string} path - path under the API prefix.
     * @param {RequestInit} [init] - fetch options.
     * @returns {Promise<Record<string, unknown>>} the `result` payload.
     */
    async function request(path, init) {
      const options = {
        credentials: 'same-origin',
        ...init,
        headers: { accept: 'application/json', ...(init?.headers ?? {}) },
      }
      const response = await fetch(`${API}${path}`, options)
      let payload
      try {
        payload = await response.json()
      } catch {
        throw new Error(`HTTP ${response.status}`)
      }
      if (payload?.ok !== true) throw new Error(payload?.error ?? `HTTP ${response.status}`)
      return payload.result
    }

    /** Settings navigation icon: one shared tools glyph. */
    function ChatModeToolsIcon({ size = 16 }) {
      return ToolsIcon === undefined ? null : h(ToolsIcon, { size })
    }

    /**
     * Join a pack's declared tools for display.
     * @param {Record<string, unknown>} pack - normalized pack.
     * @returns {string}
     */
    function describePackTools(pack) {
      const parts = []
      if (typeof pack.prefix === 'string') parts.push(`${pack.prefix}*`)
      if (Array.isArray(pack.tools)) parts.push(...pack.tools)
      return parts.join(', ')
    }

    /**
     * The settings page. It never receives `ctx`: the API client, locale face,
     * and translator arrive through the slot registration's inject face.
     * @param {{ t: Function, localeFace: object, api: object }} props
     * @returns {object}
     */
    function ChatModeToolsSection({ t, localeFace, api }) {
      const [, setLocaleRevision] = useState(0)
      useEffect(
        () => localeFace.subscribe(() => setLocaleRevision(value => value + 1)),
        [localeFace],
      )

      const [config, setConfig] = useState(null)
      const [custom, setCustom] = useState([])
      const [path, setPath] = useState('')
      const [configError, setConfigError] = useState(null)
      const [loading, setLoading] = useState(true)
      const [candidates, setCandidates] = useState(null)
      const [candidatesLoading, setCandidatesLoading] = useState(false)
      const [busy, setBusy] = useState(false)
      const [notice, setNotice] = useState(null)
      const [label, setLabel] = useState('')
      const [guidance, setGuidance] = useState('')
      const [selected, setSelected] = useState([])
      const [drafts, setDrafts] = useState({})

      /** Adopt one `/tools` snapshot and keep unsaved drafts for remaining packs. */
      const applyConfigSnapshot = (snapshot) => {
        const nextConfig = snapshot?.config ?? { version: 1, tools: [] }
        setConfig(nextConfig)
        setCustom(Array.isArray(snapshot?.custom) ? snapshot.custom : [])
        setPath(typeof snapshot?.path === 'string' ? snapshot.path : '')
        setConfigError(typeof snapshot?.error === 'string' && snapshot.error !== '' ? snapshot.error : null)
        setDrafts((previous) => {
          const next = {}
          for (const pack of nextConfig.tools ?? []) {
            next[pack.id] = previous[pack.id] !== undefined ? previous[pack.id] : (pack.guidance ?? '')
          }
          return next
        })
      }

      // The page loads on entry; the Host registry is read at request time, so
      // this is the “entered the page” refresh required for the candidate list.
      useEffect(() => {
        let cancelled = false
        const load = async () => {
          try {
            const [snapshot, candidateResult] = await Promise.all([api.loadConfig(), api.loadCandidates()])
            if (cancelled) return
            applyConfigSnapshot(snapshot)
            setCandidates(Array.isArray(candidateResult.tools) ? candidateResult.tools : [])
          } catch (error) {
            if (!cancelled) {
              setNotice({
                kind: 'error',
                text: `${t('settings.requestFailed')}: ${error instanceof Error ? error.message : String(error)}`,
              })
            }
          } finally {
            if (!cancelled) setLoading(false)
          }
        }
        void load()
        return () => { cancelled = true }
      }, [api])

      const refresh = async () => {
        if (busy) return
        setCandidatesLoading(true)
        setNotice(null)
        try {
          const [snapshot, candidateResult] = await Promise.all([api.loadConfig(), api.loadCandidates()])
          applyConfigSnapshot(snapshot)
          setCandidates(Array.isArray(candidateResult.tools) ? candidateResult.tools : [])
        } catch (error) {
          setNotice({
            kind: 'error',
            text: `${t('settings.requestFailed')}: ${error instanceof Error ? error.message : String(error)}`,
          })
        } finally {
          setCandidatesLoading(false)
        }
      }

      const saveNew = async () => {
        const menuName = label.trim()
        if (busy || menuName === '' || selected.length === 0 || configError !== null) return
        setBusy(true)
        setNotice(null)
        try {
          await api.addTool({ label: menuName, tools: selected, guidance })
          setLabel('')
          setGuidance('')
          setSelected([])
          const [snapshot, candidateResult] = await Promise.all([api.loadConfig(), api.loadCandidates()])
          applyConfigSnapshot(snapshot)
          setCandidates(Array.isArray(candidateResult.tools) ? candidateResult.tools : [])
          setNotice({ kind: 'ok', text: t('settings.saved') })
        } catch (error) {
          setNotice({
            kind: 'error',
            text: `${t('settings.saveFailed')}: ${error instanceof Error ? error.message : String(error)}`,
          })
        } finally {
          setBusy(false)
        }
      }

      const setHidden = async (pack, hidden) => {
        if (busy || configError !== null) return
        setBusy(true)
        setNotice(null)
        try {
          const snapshot = await api.updateTool({ id: pack.id, hidden })
          applyConfigSnapshot(snapshot)
          setNotice({ kind: 'ok', text: hidden ? t('settings.hiddenNotice') : t('settings.shownNotice') })
        } catch (error) {
          setNotice({
            kind: 'error',
            text: `${t('settings.saveFailed')}: ${error instanceof Error ? error.message : String(error)}`,
          })
        } finally {
          setBusy(false)
        }
      }

      const submitGuidance = async (pack) => {
        const draft = drafts[pack.id] ?? ''
        if (busy || configError !== null || draft === (pack.guidance ?? '')) return
        setBusy(true)
        setNotice(null)
        try {
          const snapshot = await api.updateTool({ id: pack.id, guidance: draft })
          applyConfigSnapshot(snapshot)
          setNotice({ kind: 'ok', text: t('settings.saved') })
        } catch (error) {
          setNotice({
            kind: 'error',
            text: `${t('settings.saveFailed')}: ${error instanceof Error ? error.message : String(error)}`,
          })
        } finally {
          setBusy(false)
        }
      }

      const discardGuidance = (pack) => {
        setDrafts(previous => ({ ...previous, [pack.id]: pack.guidance ?? '' }))
      }

      const toggleCandidate = (name) => {
        if (busy) return
        setSelected(previous => (previous.includes(name)
          ? previous.filter(entry => entry !== name)
          : [...previous, name]))
      }

      const packs = config?.tools ?? []
      const customById = new Map(custom.map(pack => [pack.id, pack]))
      const selectedSet = new Set(selected)
      const configLocked = configError !== null

      return h('section', { className: 'dsh-chat-settings' },
        h('h2', { className: 'dsh-chat-settings-title' }, t('settings.title')),
        h('p', { className: 'dsh-chat-settings-intro' }, t('settings.intro')),

        h('div', { className: 'dsh-chat-settings-meta' },
          h('span', { className: 'dsh-chat-field-label' }, t('settings.configPath')),
          h('code', null, path === '' ? t('settings.configPathUnknown') : path),
          configLocked
            ? h('p', { className: 'dsh-chat-alert' }, `${t('settings.configError')}: ${configError}`)
            : null,
          h('span', { className: 'dsh-chat-hint' }, t('settings.configEditable')),
        ),

        notice === null
          ? null
          : h('p', { className: notice.kind === 'error' ? 'dsh-chat-alert' : 'dsh-chat-notice' }, notice.text),

        loading
          ? h('p', { className: 'dsh-chat-hint' }, t('settings.loading'))
          : h('div', { className: 'dsh-chat-settings-group' },
            h('h3', { className: 'dsh-chat-settings-heading' }, t('settings.current')),
            h('p', { className: 'dsh-chat-hint' }, t('settings.hiddenHint')),
            packs.length === 0
              ? h('p', { className: 'dsh-chat-hint' }, t('settings.empty'))
              : packs.map((pack) => {
                const availability = customById.get(pack.id)
                const available = availability?.available === true
                const hidden = pack.hidden === true
                const draft = drafts[pack.id] ?? pack.guidance ?? ''
                const dirty = draft !== (pack.guidance ?? '')
                const icon = iconFor(pack.icon)
                return h('article', {
                  key: pack.id,
                  className: 'dsh-chat-pack' + (hidden ? ' dsh-chat-pack--hidden' : ''),
                },
                  h('header', { className: 'dsh-chat-pack-head' },
                    h('span', { className: 'dsh-chat-pack-icon', 'aria-hidden': true },
                      icon === undefined ? null : h(icon, { size: 16 })),
                    h('span', { className: 'dsh-chat-pack-title' }, pack.label),
                    h('code', { className: 'dsh-chat-pack-id' }, pack.id),
                    hidden ? h('span', { className: 'dsh-chat-badge dsh-chat-badge--warn' }, t('settings.hidden')) : null,
                    available
                      ? h('span', { className: 'dsh-chat-badge dsh-chat-badge--ok' }, t('settings.available'))
                      : h('span', { className: 'dsh-chat-badge' }, t('settings.unavailable')),
                    h('button', {
                      type: 'button',
                      className: 'dsh-chat-button dsh-chat-pack-action',
                      disabled: busy || configLocked,
                      onClick: () => { void setHidden(pack, !hidden) },
                    }, hidden ? t('settings.show') : t('settings.hide')),
                  ),
                  h('div', { className: 'dsh-chat-pack-row' },
                    h('span', { className: 'dsh-chat-pack-label' }, t('settings.actualTools')),
                    h('code', { className: 'dsh-chat-pack-tools' }, describePackTools(pack) || '—'),
                  ),
                  h('label', { className: 'dsh-chat-field' },
                    h('span', { className: 'dsh-chat-field-label' }, t('settings.guidance')),
                    h('textarea', {
                      className: 'dsh-chat-textarea',
                      value: draft,
                      spellCheck: false,
                      disabled: busy,
                      onChange: (event) => {
                        const value = event.target.value
                        setDrafts(previous => ({ ...previous, [pack.id]: value }))
                      },
                    }),
                  ),
                  h('div', { className: 'dsh-chat-actions' },
                    h('button', {
                      type: 'button',
                      className: 'dsh-chat-button dsh-chat-button--primary',
                      disabled: busy || configLocked || !dirty,
                      onClick: () => { void submitGuidance(pack) },
                    }, t('settings.submit')),
                    h('button', {
                      type: 'button',
                      className: 'dsh-chat-button',
                      disabled: busy || configLocked || !dirty,
                      onClick: () => discardGuidance(pack),
                    }, t('settings.discard')),
                    dirty ? h('span', { className: 'dsh-chat-hint' }, t('settings.unsaved')) : null,
                  ),
                )
              }),
            h('p', { className: 'dsh-chat-hint' }, t('settings.builtinNote')),
          ),

        h('div', { className: 'dsh-chat-settings-group' },
          h('h3', { className: 'dsh-chat-settings-heading' }, t('settings.addTitle')),
          h('p', { className: 'dsh-chat-hint' }, t('settings.addHint')),
          h('div', { className: 'dsh-chat-candidates-head' },
            h('span', { className: 'dsh-chat-field-label' }, t('settings.selectTools')),
            h('button', {
              type: 'button',
              className: 'dsh-chat-button',
              disabled: busy || candidatesLoading,
              onClick: () => { void refresh() },
            }, candidatesLoading ? t('settings.refreshing') : t('settings.refresh')),
            h('span', { className: 'dsh-chat-hint' }, t('settings.selectedCount', { n: selected.length })),
          ),
          candidates === null
            ? h('p', { className: 'dsh-chat-hint' }, t('settings.loading'))
            : candidates.length === 0
              ? h('p', { className: 'dsh-chat-hint' }, t('settings.noCandidates'))
              : h('div', { className: 'dsh-chat-candidates' },
                candidates.map((candidate) => h('label', {
                  key: candidate.name,
                  className: 'dsh-chat-candidate' + (candidate.configured ? ' dsh-chat-candidate--configured' : ''),
                },
                  h('input', {
                    type: 'checkbox',
                    checked: selectedSet.has(candidate.name),
                    disabled: busy || candidate.configured,
                    onChange: () => toggleCandidate(candidate.name),
                  }),
                  h('span', { className: 'dsh-chat-candidate-main' },
                    h('code', { className: 'dsh-chat-candidate-name' }, candidate.name),
                    candidate.configured
                      ? h('span', { className: 'dsh-chat-badge' }, t('settings.configured'))
                      : null,
                    candidate.description
                      ? h('span', { className: 'dsh-chat-candidate-desc' }, candidate.description)
                      : null,
                  ),
                )),
              ),
          h('label', { className: 'dsh-chat-field' },
            h('span', { className: 'dsh-chat-field-label' }, t('settings.menuName')),
            h('input', {
              className: 'dsh-chat-input',
              type: 'text',
              value: label,
              placeholder: t('settings.menuNamePlaceholder'),
              spellCheck: false,
              disabled: busy,
              onChange: (event) => setLabel(event.target.value),
            }),
          ),
          h('label', { className: 'dsh-chat-field' },
            h('span', { className: 'dsh-chat-field-label' }, t('settings.guidance')),
            h('textarea', {
              className: 'dsh-chat-textarea',
              value: guidance,
              spellCheck: false,
              disabled: busy,
              onChange: (event) => setGuidance(event.target.value),
            }),
            h('span', { className: 'dsh-chat-hint' }, t('settings.guidanceHint')),
          ),
          h('div', { className: 'dsh-chat-actions' },
            h('button', {
              type: 'button',
              className: 'dsh-chat-button dsh-chat-button--primary',
              disabled: busy || configLocked || label.trim() === '' || selected.length === 0,
              onClick: () => { void saveNew() },
            }, busy ? t('settings.adding') : t('settings.add')),
          ),
          h('p', { className: 'dsh-chat-hint' }, t('settings.newPackOff')),
        ),
      )
    }

    return {
      inject: ['slots', 'sessions', 'locale'],
      // Exported for the smoke test; the slot runtime ignores extra members.
      visibleToolItems,
      selectedToolIds,
      toolCommand,
      sameTools,
      apply(ctx) {
        const copy = ctx.locale.bind(NS)
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'chat-mode: locale')
        const style = document.createElement('style')
        style.textContent = STYLE_TEXT
        document.head.append(style)
        ctx.effect(() => () => style.remove(), 'chat-mode: styles')

        ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
          name: 'conversation.input.left',
          id: 'chat-mode-controls',
          order: 10,
          locale: NS,
          inject: (sessionId) => ({
            runCommand: (line) => {
              const live = ctx.sessions.binding(sessionId)?.session
              if (live === undefined) return Promise.resolve(false)
              return live.command(line).then(
                result => result.ok === true && result.value?.matched === true,
                () => false,
              )
            },
          }),
        }, ChatModeControls))

        // The settings page talks to the Host through the same owner-only API
        // the composer uses; no configForms ownership or profile mutation.
        const api = {
          loadConfig: () => request('/tools'),
          loadCandidates: () => request('/candidates'),
          addTool: (payload) => request('/tools', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          }),
          updateTool: (payload) => request('/tools', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          }),
        }
        const localeFace = {
          subscribe: (listener) => ctx.locale.subscribe(listener),
          getSnapshot: () => ctx.locale.getSnapshot(),
        }
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: SETTINGS_SECTION_ID,
          order: SETTINGS_SECTION_ORDER,
          label: () => copy('settings.nav'),
          locale: NS,
          inject: () => ({ t: copy, localeFace, api }),
        }, ChatModeToolsSection))

        ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
          name: 'settings.section.icon',
          id: SETTINGS_SECTION_ID,
        }, ChatModeToolsIcon))
      },
    }
  },
})
