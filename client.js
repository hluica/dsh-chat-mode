/**
 * Browser half of chat mode.
 *
 * It adds two compact dropdowns to the composer tool row for sessions that
 * selected the `chat` Agent preset:
 *
 * - Permission: read-only / workspace-write. The Agent-scoped `/permission`
 *   command in `preset.js` is the authority; the shipped permission control is
 *   hidden for chat sessions so "Full access" is not offered here.
 * - Tools: off / shell / web search / both. Each pick writes `/chat-tools`.
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

    /** Locale dictionary namespace owned by this plugin. */
    const NS = 'chatMode'

    /** Chinese copy for the two dropdowns. */
    const zh = {
      'permission.trigger': '权限：{value}',
      'permission.readOnly': '仅可查看',
      'permission.workspaceWrite': '工作区内修改',
      'permission.unavailable': '不可用',
      'permission.title': '选择对话模式的权限',
      'tools.trigger': '工具：{value}',
      'tools.off': '全部关闭',
      'tools.shell': '命令执行',
      'tools.search': '联网搜索',
      'tools.both': '命令 + 联网',
      'tools.title': '启用或关闭对话模式的高级工具',
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
      'tools.shell': 'Shell',
      'tools.search': 'Web search',
      'tools.both': 'Shell + Web',
      'tools.title': 'Enable or disable chat-mode advanced tools',
    }

    /**
     * Hide only the shipped current-session permission control, and only while
     * a chat session is rendered. The `data-slot` anchor is the renderer's
     * stable slot wrapper; if a future DSH version renames it, the Host-side
     * `/permission` shadow still refuses full access.
     */
    const STYLE_TEXT = 'body[data-dsh-chat-mode="1"] [data-slot="conversation.input.permission"]{display:none !important}'

    /** Compact trigger shared by both dropdowns. */
    const TRIGGER_STYLE = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      height: 24,
      maxWidth: 180,
      padding: '0 6px',
      border: '1px solid var(--dsw-alias-border-l1)',
      borderRadius: 6,
      background: 'transparent',
      color: 'var(--dsw-alias-label-secondary)',
      font: 'inherit',
      fontSize: 12,
      lineHeight: '22px',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
    }

    /** Theme-colored trigger for an active advanced-tool choice. */
    const ACTIVE_TRIGGER_STYLE = {
      ...TRIGGER_STYLE,
      color: 'var(--dsw-alias-brand-primary)',
      borderColor: 'var(--dsw-alias-brand-primary)',
    }

    /** Render one dropdown trigger button. */
    function trigger(label, title, open, disabled, onClick, active) {
      return h('button', {
        type: 'button',
        disabled,
        title,
        'aria-label': title,
        'aria-expanded': open,
        onClick,
        style: {
          ...(active ? ACTIVE_TRIGGER_STYLE : TRIGGER_STYLE),
          ...(disabled ? { cursor: 'default', opacity: 0.55 } : {}),
        },
      },
        h('span', {
          style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
        }, label),
        Chevron === undefined
          ? h('span', { style: { fontSize: 10, opacity: 0.7 } }, '▾')
          : h('span', { style: { display: 'inline-flex', width: 12, height: 12, opacity: 0.7 } }, h(Chevron)),
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

      // Hide the shipped permission control only while a chat session is active.
      useEffect(() => {
        if (isChat) document.body.dataset.dshChatMode = '1'
        else delete document.body.dataset.dshChatMode
        return () => { delete document.body.dataset.dshChatMode }
      }, [isChat])

      if (!isChat) return null

      const permissionValue = selection?.currentValue
      const permissionLabel = permissionValue === 'read-only'
        ? t('permission.readOnly')
        : permissionValue === 'workspace-write'
          ? t('permission.workspaceWrite')
          : (permissionValue ?? t('permission.unavailable'))
      const permissionItems = [
        { id: 'read-only', label: t('permission.readOnly') },
        { id: 'workspace-write', label: t('permission.workspaceWrite') },
      ]

      const toolsValue = tools === undefined
        ? 'off'
        : tools.shell && tools.webSearch
          ? 'both'
          : tools.shell
            ? 'shell'
            : tools.webSearch
              ? 'search'
              : 'off'
      const toolsLabel = t(`tools.${toolsValue}`)
      const toolsItems = [
        { id: 'off', label: t('tools.off') },
        { id: 'shell', label: t('tools.shell') },
        { id: 'search', label: t('tools.search') },
        { id: 'both', label: t('tools.both') },
      ]

      const disabled = locked === true || selection === undefined
      const toolsActive = toolsValue !== 'off'

      return h('span', {
        style: { display: 'inline-flex', alignItems: 'center', gap: 6 },
      },
        h(Menu, {
          open: permissionOpen,
          items: permissionItems,
          selectedId: permissionValue,
          onSelect: (id) => {
            setPermissionOpen(false)
            if (id !== permissionValue) void runCommand(`/permission ${id}`)
          },
          onClose: () => { setPermissionOpen(false) },
          side: 'top',
          portal: true,
          anchor: trigger(
            t('permission.trigger', { value: permissionLabel }),
            t('permission.title'),
            permissionOpen,
            disabled,
            () => { if (!disabled) setPermissionOpen(!permissionOpen) },
            false,
          ),
        }),
        h(Menu, {
          open: toolsOpen,
          items: toolsItems,
          selectedId: toolsValue,
          onSelect: (id) => {
            setToolsOpen(false)
            if (id !== toolsValue) void runCommand(`/chat-tools mode ${id}`)
          },
          onClose: () => { setToolsOpen(false) },
          side: 'top',
          portal: true,
          anchor: trigger(
            t('tools.trigger', { value: toolsLabel }),
            t('tools.title'),
            toolsOpen,
            locked === true,
            () => { if (locked !== true) setToolsOpen(!toolsOpen) },
            toolsActive,
          ),
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
