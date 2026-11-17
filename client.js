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
 * - Tools: a multi-select menu with two items, “持久终端” and “联网搜索”.
 *   Checking either one enables that tool; checking both enables both. The
 *   menu stays open while toggling, and `TOOL_ITEMS` is data-driven so future
 *   tools can be added without rewriting the control.
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

    /**
     * The tools menu is one data table: adding a future tool means adding one
     * entry here plus its state field, Host gate, and command branch. The
     * trigger and multi-select logic stay unchanged.
     */
    const TOOL_ITEMS = [
      { id: 'shell', stateKey: 'shell', labelKey: 'tools.shell', icon: ShellIcon },
      { id: 'search', stateKey: 'webSearch', labelKey: 'tools.search', icon: WebIcon },
    ]

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
      'tools.both': '持久终端 + 联网',
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
      'tools.both': 'Shell + Web',
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

      // Hide the shipped permission control only while a chat session is active.
      useEffect(() => {
        if (isChat) document.body.dataset.dshChatMode = '1'
        else delete document.body.dataset.dshChatMode
        return () => { delete document.body.dataset.dshChatMode }
      }, [isChat])

      const liveTools = tools === undefined
        ? { shell: false, webSearch: false }
        : { shell: tools.shell === true, webSearch: tools.webSearch === true }
      const effectiveTools = pendingTools ?? liveTools

      // Keep the optimistic selection until the durable projection catches up.
      useEffect(() => {
        if (pendingTools === null) return
        if (pendingTools.shell === liveTools.shell && pendingTools.webSearch === liveTools.webSearch) {
          setPendingTools(null)
        }
      }, [pendingTools, liveTools.shell, liveTools.webSearch])

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

      const selectedTools = TOOL_ITEMS
        .filter(item => effectiveTools[item.stateKey] === true)
        .map(item => item.id)
      const toolsValue = selectedTools.length === 0
        ? 'off'
        : effectiveTools.shell && effectiveTools.webSearch
          ? 'both'
          : effectiveTools.shell
            ? 'shell'
            : 'search'
      const toolsItems = TOOL_ITEMS.map(item => ({
        id: item.id,
        label: t(item.labelKey),
        ...(item.icon ? { icon: h(item.icon) } : {}),
      }))
      const toolsLabel = t(`tools.${toolsValue}`)
      const toolsActive = selectedTools.length > 0

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
            const next = { shell: effectiveTools.shell, webSearch: effectiveTools.webSearch }
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
