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
 * - Tools: a multi-select menu driven by `TOOL_ITEMS`. “持久终端” and
 *   “联网搜索” are always offered; “Wolfram” appears only while the
 *   owner-only `/dsh-chat-mode/api/state` route reports registered
 *   `mcp__WolframLanguage__*` tools. Checking an item enables that pack;
 *   checking several enables all of them. The menu stays open while toggling.
 *   The Wolfram icon is copied from `@local/dsh-wolfram-mcp` so the plugin
 *   keeps its zero-dependency client inject list.
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

    /** Owner-only Host route polled for dynamic tool-pack availability. */
    const API = '/dsh-chat-mode/api'

    /**
     * The tools menu is one data table. `availableKey` marks a dynamic pack:
     * the item is rendered only while the Host availability route reports that
     * pack as available. Adding a future pack means one entry here (plus its
     * state field, Host pack entry, and command branch).
     */
    const TOOL_ITEMS = [
      { id: 'shell', stateKey: 'shell', labelKey: 'tools.shell', icon: ShellIcon },
      { id: 'search', stateKey: 'webSearch', labelKey: 'tools.search', icon: WebIcon },
      { id: 'wolfram', stateKey: 'wolfram', labelKey: 'tools.wolfram', icon: WolframMcpIcon, availableKey: 'wolfram' },
    ]

    /** Filter the menu items by the last availability snapshot. */
    function visibleToolItems(availability) {
      return TOOL_ITEMS.filter(item =>
        item.availableKey === undefined || availability?.[item.availableKey] === true)
    }

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

    /** Chinese copy for the two dropdowns. */
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
    }

    /** English copy for the two dropdowns. */
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
    }

    /**
     * Trigger and menu-item styling. All colors come from the host theme
     * tokens; the shipped `Menu` owns the popup surface, so only our trigger
     * and the item icons/checks are styled here. The final rule keeps hiding
     * the shipped current-session permission seat for chat sessions.
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
      const [availability, setAvailability] = useState({ wolfram: false })

      // Hide the shipped permission control only while a chat session is active.
      useEffect(() => {
        if (isChat) document.body.dataset.dshChatMode = '1'
        else delete document.body.dataset.dshChatMode
        return () => { delete document.body.dataset.dshChatMode }
      }, [isChat])

      // Dynamic availability is environment state owned by the Host tool
      // registry. The Session projection carries only the user's choice, so the
      // Client asks the owner-only route and polls it: no session event type is
      // invented, and an MCP registration/removal is reflected without a page
      // reload. A failed request keeps the last known snapshot.
      useEffect(() => {
        if (!isChat) return undefined
        let cancelled = false
        let timer
        const refresh = async () => {
          try {
            const response = await fetch(`${API}/state`, { cache: 'no-store' })
            const payload = await response.json()
            if (!cancelled && payload?.ok === true) {
              setAvailability({ wolfram: payload.result?.wolfram === true })
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
        ? { shell: false, webSearch: false, wolfram: false }
        : {
            shell: tools.shell === true,
            webSearch: tools.webSearch === true,
            wolfram: tools.wolfram === true,
          }
      const effectiveTools = pendingTools ?? liveTools
      const visibleItems = visibleToolItems(availability)

      // Keep the optimistic selection until the durable projection catches up.
      useEffect(() => {
        if (pendingTools === null) return
        if (pendingTools.shell === liveTools.shell
          && pendingTools.webSearch === liveTools.webSearch
          && pendingTools.wolfram === liveTools.wolfram) {
          setPendingTools(null)
        }
      }, [pendingTools, liveTools.shell, liveTools.webSearch, liveTools.wolfram])

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

      const selectedItems = visibleItems.filter(item => effectiveTools[item.stateKey] === true)
      const selectedTools = selectedItems.map(item => item.id)
      const toolsItems = visibleItems.map(item => ({
        id: item.id,
        label: t(item.labelKey),
        ...(item.icon ? { icon: h(item.icon) } : {}),
      }))
      const toolsLabel = selectedItems.length === 0
        ? t('tools.off')
        : selectedItems.map(item => t(item.labelKey)).join(' + ')
      const toolsActive = selectedItems.length > 0

      const permissionDisabled = locked === true || selection === undefined
      const toolsDisabled = locked === true

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
          onSelect: (id) => {
            // Multi-select: keep the menu open and toggle one item.
            const item = TOOL_ITEMS.find(entry => entry.id === id)
            if (item === undefined) return
            const next = {
              shell: effectiveTools.shell,
              webSearch: effectiveTools.webSearch,
              wolfram: effectiveTools.wolfram,
            }
            next[item.stateKey] = !next[item.stateKey]
            setPendingTools(next)
            void runCommand(`/chat-tools ${item.id} ${next[item.stateKey] ? 'on' : 'off'}`)
              .then((ok) => { if (!ok) setPendingTools(null) })
          },
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

    return {
      inject: ['slots', 'sessions', 'locale'],
      // Exported for the smoke test and for future tool packs that need the
      // same availability filter; the slot runtime ignores extra members.
      visibleToolItems,
      apply(ctx) {
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
      },
    }
  },
})
