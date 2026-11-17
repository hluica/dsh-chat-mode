# 对话模式（Agent preset `chat`）可行性、进路与实施计划

- **Harness 版本**：`0.2.2-rc.3`（`DSH_INSTALL_DIR/package.json` 为 `@deepseek-ai/dsh@0.2.2-rc.3`）
- **工作区**：`/Users/hanluica/Documents/deepseek-harness/local-plugins/dsh-chat-mode`
- **状态**：`1.0.0` 已实施并完成 Host 端集成验证（2026-11-17）；`1.1.0` 工具多选菜单与下拉框外观优化已实施并通过构建/逻辑测试（2026-11-17），客户端视觉验收待用户刷新页面后新建/打开 Chat 会话确认。2026-11-17 追加新 Chat 会话权限与首轮工具可见性修复设计（目标版本 `1.1.1`），待新轮次实施。
- **文档日期**：2026-11-17

---

## 一、目的与范围

### 1.1 要解决的问题

新增一个 Agent 预设模式 **对话模式**（preset id：`chat`），让用户可以在 DSH 中主动选择一种“以对话为主、尽量不碰工作区”的 Agent 形态。它应当：

1. 以纯对话为默认行为，最小化 Agent 对实际文件的读写。
2. 仍然提供一部分文件系统工具，但 Agent 只在用户**明确指示**时才使用，包括读取文件；用户手动附加到对话中的文件除外。
3. 以极简模式（`minimal`）为基准，从极简模式与标准模式的工具差集中挑选少量额外工具，使对话功能和上下文更丰富。
4. 部分工具默认不可用，只有用户通过界面显式启用后才可使用。
5. 选中该模式时，把 Agent 的权限选项锁定为 **仅可查看（read-only）** 与 **工作区内修改（workspace-write）**，不允许选择 **完全权限（danger-full-access）**；同时保留模型申请一次性权限（one-time escalation）的能力。
6. 使用更贴合对话场景的 system instructions，而不是默认的编码 Agent 身份。

### 1.2 边界

**包含**：

- 一个新的本地插件包 `@local/dsh-chat-mode`，以及其中的 Agent preset 声明。
- 对话模式的插件组合、工具清单、权限策略、工具按需启用机制、system prompt 与最小客户端控件。
- 在本 Harness 版本下的可行性证据、接入点与验证方法。

**不包含**：

- 修改或删除现有 `standard` / `ptc` / `minimal` / `cordis` 预设的行为。
- 修改全局权限预设表，使其他模式也失去“完全权限”。
- 文件写入、Office、日程、子 Agent、Workflow、Goal、Plan、Todo 等与“纯对话”无关的能力。
- 对 DSH 上游包源码的打补丁或 fork。

### 1.3 关键结论

**总体可行。** DSH 0.2.2-rc.3 已经提供了实现该模式所需的全部接入点：

- Agent preset 由 bundle patch 声明，插件列表可挂载本地包的子路径。
- 工具注册表支持按 Agent 作用域做 `restrict()`，且可以限制祖先作用域（preset 作用域）中注册的工具；这正好可以隐藏默认关闭的工具 schema。
- 命令注册表支持按作用域 shadow 同名全局命令；可以在 preset 作用域 shadow `/permission`，拒绝 `danger-full-access`。
- 会话投影可以持久化“哪些工具被用户启用”，并供客户端读取。
- 客户端插槽 `conversation.input.left` 可以放置一个只对 `chat` 会话显示的控件；客户端可以读取 `agentPreset` 与 `permissions` 投影。
- `read-only` 与 `workspace-write` 两个权限预设的 approval policy 都是 `ask`，因此模型的一次性权限申请路径不会被关闭。

有两个实现细节需要在代码阶段实测确认（不影响可行性，只影响实现方式）：

1. **preset 作用域注册的 `/permission` 是否能 shadow 全局 `/permission`**。命令注册表的 `view()` 会合并 global 与 scoped 层，理论上最近的 scoped 层胜出；但 `dsh-commands` README 的措辞是“mounted beneath an agent's own context”。若 preset 作用域不能 shadow，则回退为在 `agent/created` 时通过 `agent.ctx` 注册，并在 preset 卸载时显式 dispose。
2. **`tools.restrict()` 在 `agent.ctx` 上是否能限制 preset 作用域注册的 `bash`/`web_search`**。源码 `view()` 把 `own` 层之外的祖先层全部放进 `inherited`，`restrictableNames` 来自 `inherited`，因此应当可以；代码阶段用 `agent.ctx.tools.get('bash')` 与 `schemas()` 验证。

---

## 二、可行性

### 2.1 版本与安装形态

当前运行的是 Desktop 打包版：

- `DSH_PROFILE=desktop`
- `DSH_INSTALL_DIR=/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh`
- `@deepseek-ai/dsh@0.2.2-rc.3`
- `@deepseek-ai/dsh-web-app@0.2.2-rc.3`

`@deepseek-ai/dsh-web-app` 的 `dsh.bundle.patch` 列出四个预设文件：

```text
presets/standard.patch.yml
presets/ptc.patch.yml
presets/minimal.patch.yml
presets/cordis.patch.yml
```

每个文件都是一条 `insert` 的 `@deepseek-ai/dsh-agent-preset` 声明。新增 `chat` 预设属于同一形态：一个 bundle 的 patch 里插入声明即可。

**证据**：

- `@deepseek-ai/dsh-web-app/presets/minimal.patch.yml`
- `@deepseek-ai/dsh-web-app/presets/standard.patch.yml`
- `@deepseek-ai/dsh-agent-preset-registry/README.md`（“A new preset or an override of a shipped one is a bundle patch”）

### 2.2 Agent preset 声明能力

`@deepseek-ai/dsh-agent-preset` 的声明字段：

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| `id` | 必填 | 稳定的 preset 标识；`chat` |
| `plugins` | 必填 | 子插件条目列表 |
| `name` | 可选 | 显示名 |
| `description` | 可选 | 显示描述 |
| `order` | 可选 | 花名册顺序 |

`@deepseek-ai/dsh-agent-preset-registry` 负责：

- 在声明激活时**急切**创建 registry 拥有的 scope 与内存 Loader 树。
- 通过 `presetForSession(session)` 读取会话已记录的 preset id。
- 把 preset 声明的子插件注册在 preset scope 中；Agent scope 的父链决定可见性。
- 激活审计会检查 import、缺失 service、全局泄漏 service。

**对本任务的含义**：

- 对话模式的组合与工具全部写在声明里，不需要修改上游预设。
- 本地包可以通过 `exports` 暴露一个 `./preset` 子路径，作为 preset 的子插件被加载。
- preset 子插件是**共享**的（同一修订被所有选择该 preset 的 Agent 共用），因此：
  - 监听 `agent/created` / `agent/pre-step` 的 preset 级 listener 会收到该 preset 下所有 Agent 的事件；
  - 按 Agent 的 `restrict()`、按会话的投影、按会话的状态需要用 `Session`/`Agent` 作为 key。

**证据**：

- `@deepseek-ai/dsh-agent-preset/README.md`
- `@deepseek-ai/dsh-agent-preset-registry/src/index.ts`：`presetForSession`、`select`、`inspectCompositions`
- `@deepseek-ai/dsh-agent/src/index.ts`：`setup` 文档说明“通过 `agentCtx` 注册的一切（scoped tools、prompt sections/variables、`restrict()`、listeners、awaited child plugins）在 `agent/created` 之前已存在”

### 2.3 极简模式与标准模式的差集

#### 极简模式（`minimal`）的插件

```text
persona（complete: true, includeRuntimeContext: false）
tool-fs（read: false, readImage: true, write: false, edit: false）
compaction group
  compaction-basic
  command-compact
persistent-shell group（isolate terminals）
  dsh-terminal
  dsh-terminal-bash（posix）
  dsh-tool-bash-persistent（posix）
  dsh-terminal-bash（pwsh）
  dsh-tool-pwsh-persistent（pwsh）
```

#### 标准模式（`standard`）相对极简模式多出的插件

```text
agent-instructions
time-context
tool-bash / tool-pwsh（一次性前台命令）
tool-fs（完整 read/read_image/write/edit，applyPatch: false）
tool-fs-search
tool-jobs
tool-schedule
skill-filesystem
tool-skill
command-goal
tool-goal
plan-mode group
compaction tool-result-pruner
delegation group（subagent、subagent_fork、workflow、subagent-control）
tool-ask-user
tool-todo
tool-web
present
tool-office
tool-plugin-manager
tool-plugin-market（disabled）
```

注意：极简模式用 **persistent-shell**，标准模式用 **一次性 bash**；两者不是简单叠加。对话模式以极简模式为基线时，会继承 persistent-shell，但本方案把它作为“默认关闭、用户显式启用”的高级工具保留。

#### 本方案从差集中选入的工具

| 插件 | 是否选入 | 理由 |
| --- | --- | --- |
| `time-context` | ✅ 选入 | 对话经常涉及“今天/现在/多久”等时间指代；注入当前时间、浏览器时区与经过时间，显著改善上下文。 |
| `tool-fs-search` | ✅ 选入 | 只读的 `glob`/`grep`，用于定位用户明确提到的内容；不修改文件。 |
| `tool-ask-user` | ✅ 选入 | 对话需要澄清、选择、确认；比让模型用普通文本“假装提问”更好。 |
| `tool-web` | ✅ 选入 | 对话需要联网搜索与读取用户给出的链接；与官方 chat-demo 的 `deepseek_web_search` / `deepseek_read_url` 对应。 |
| `compaction-tool-result-pruner` | ✅ 建议选入 | 联网读取的结果可能很长；在进入上下文前裁剪，减轻上下文压力。不属于模型工具。 |
| `agent-instructions` | ❌ 不选入 | 会自动读取工作区 `AGENTS.md` 等文件，违背“最小化文件读取”的目标。 |
| `tool-bash` / `tool-pwsh` | ❌ 不选入 | 极简模式已有 persistent-shell；不重复提供一次性前台命令。 |
| `tool-jobs` | ❌ 不选入 | 仅在需要后台任务管理时有用；对话模式不主动执行长任务。 |
| `tool-schedule` | ❌ 不选入 | 日程与对话模式无关。 |
| `skill-filesystem` / `tool-skill` | ❌ 不选入 | 对话模式不加载技能目录。 |
| `command-goal` / `tool-goal` | ❌ 不选入 | 长期目标管理不属于纯对话。 |
| `plan-mode` | ❌ 不选入 | 计划模式是编码工作流；对话模式不需要。 |
| `delegation`（subagent/workflow） | ❌ 不选入 | 对话模式不派生 Agent。 |
| `tool-todo` | ❌ 不选入 | 纯对话不需要任务清单。 |
| `present` | ❌ 不选入 | 对话输出直接留在消息里，不生成交付物。 |
| `tool-office` | ❌ 不选入 | 对话模式不处理 Office 文件生成。 |
| `tool-plugin-manager` / `tool-plugin-market` | ❌ 不选入 | 对话模式不管理插件。 |

#### 极简模式基线的调整

| 极简模式原本 | 对话模式调整 | 理由 |
| --- | --- | --- |
| `tool-fs`：`read: false` | 改为 `read: true` | 用户明确要求读取文件时可用；手动附加的文件也需要读取。 |
| `tool-fs`：`readImage: true` | 保留 | 图片附件需要读取。 |
| `tool-fs`：`write/edit: false` | 保持关闭 | 对话模式不提供直接写文件工具。 |
| `persistent-shell` | 保留，但默认通过 `restrict()` 隐藏 `bash`/`pwsh` | 作为“用户显式启用后才可用”的高级能力。 |
| `compaction` | 保留，并加入 `tool-result-pruner` | 长对话与联网结果需要压缩。 |
| `persona`：`complete: true, includeRuntimeContext: false` | `complete: true, includeRuntimeContext: true` | 保留纯对话身份，但让运行时上下文（文件策略、cwd、时间）可用。 |

### 2.4 权限预设与锁定

`@deepseek-ai/dsh-base` 的 Host 配置：

```yaml
- id: permission
  name: '@deepseek-ai/dsh-permission-presets'
  config:
    presets:
      read-only:
        sandbox: read-only
        approval: ask
      workspace-write:
        sandbox: workspace-write
        approval: ask
      danger-full-access:
        sandbox: danger-full-access
        approval: never
```

关键事实：

- `read-only` 与 `workspace-write` 的 approval 都是 `ask`，所以模型仍可走一次性权限申请（工具调用里的 `sandbox_permissions` + `justification`）。
- `danger-full-access` 的 approval 是 `never`，这才是需要禁止的选择。
- `@deepseek-ai/dsh-permission-presets` 提供：
  - `current(session)`：读取会话当前预设（由 `permissions` 投影折叠）。
  - `set(session, name)`：记录 `permission/preset` 并写入变化的 sandbox/approval knob。
  - `catalog()`：进程级目录，客户端 `/permission` 选择器读取它。
- `danger-full-access` 在全局目录中，**没有** per-agent 过滤参数；因此“仅 chat 不显示完全权限”必须在客户端做，或通过 agent 级命令 shadow 在服务端拒绝。

**本方案**：

1. 在 chat preset scope 注册一个同名 `/permission` 命令，只接受 `read-only` / `workspace-write`；`danger-full-access` 返回错误。该命令通过 `@deepseek-ai/dsh-commands` 的 scoped shadow 覆盖全局 `/permission`（preset scope 是否足够，代码阶段实测；不足则回退 agent scope）。
2. 在 `agent/created` 时检查 `permissionPresets.current(session)`；若当前不是 `read-only`/`workspace-write`（例如全局默认被用户设为完全权限），调用 `permissionPresets.set(session, 'read-only')`。
3. 客户端在 chat 会话中隐藏 shipped 的 `conversation.input.permission` 控件，改为显示一个只含两个选项的自定义下拉框；服务端的命令 shadow 作为最终权威。
4. 一次性权限申请不受影响：`read-only`/`workspace-write` 的 approval 是 `ask`，工具在 sandbox 拒绝时会返回 escalation 提示。

**证据**：

- `@deepseek-ai/dsh-base/cordis.patch.yml` 第 264–276 行
- `@deepseek-ai/dsh-permission-presets/src/index.ts`：`Config`、`catalog()`、`set()`、`pinInitialPermission()`
- `@deepseek-ai/dsh-permission-presets/README.md`：“Full access” 是配置表中的普通条目，`custom` 才是派生状态
- `@deepseek-ai/dsh-commands/README.md`：“A command-producing plugin mounted beneath an agent's own context ... shadows the global definition of the same name for that agent only”
- `@deepseek-ai/dsh-commands/src/index.ts`：`register()` 使用 `layers.effect(this.ctx, ...)`；`view(agent)` 合并 global 与 scoped 层

### 2.5 工具按需启用

DSH 工具注册表提供三种可用于“默认关闭、用户启用后可用”的机制：

| 机制 | 能力 | 对本任务的适用性 |
| --- | --- | --- |
| `ctx.tools.restrict({ deny })` | 需要 `agent.ctx`；限制继承的 global/ancestor 工具；**不限制 own 层**；隐藏 schema 与执行 | ✅ 最适合：把 `bash`/`pwsh`/`web_search` 从该 Agent 的工具列表中隐藏；启用时 dispose restriction。 |
| `tools/pre-execute` waterfall | 每次调用前的 allow/deny/ask；scope-filtered | ✅ 作为兜底：防止 restriction 生效前已解析的 batch 继续执行。 |
| `register(definition, { when })` | 每次 step 求值条件，false 时从描述、PTC 绑定和执行中移除 | ⚠️ 需要工具注册方支持 `when`；`dsh-tool-bash-persistent` 和 `dsh-tool-web` 没有对外暴露这个入口，不能直接使用。 |

`ToolsService.view()` 的源码逻辑：

```text
const inherited = new Map(this.layers.global.tools.entries())
for (const layer of layers) {
  if (layer === own) continue
  for (const [name, registration] of layer.tools.entries()) inherited.set(name, registration)
}
...
for (const [name, registration] of inherited) {
  knownNames.add(name)
  restrictableNames.add(name)
  if (layers.every(layer => layer.admits(name))) visible.set(name, registration.definition)
}
```

因此，preset scope 注册的 `bash`/`pwsh`/`web_search` 位于 `agent` 的祖先层，进入 `inherited`，可被 `agent.ctx.tools.restrict({ deny: [...] })` 隐藏。

**本方案**：

- 默认（`shell: false`）：对 `agent.ctx` 注册 `restrict({ deny: ['bash'|'pwsh'] })`；模型工具列表中没有 shell。
- 默认（`webSearch: false`）：注册 `restrict({ deny: ['web_search'] })`；`web_fetch` 保持可见。
- 用户在客户端控件中启用后：dispose 对应 restriction，下一次 step 的工具 schema 出现。
- `tools/pre-execute` guard 同步检查当前选择态；若工具已关闭但旧 batch 仍带该调用，返回 deny 并给出“请在对话设置中启用”的提示。

**证据**：

- `@deepseek-ai/dsh-tools/README.md`：“`ctx.tools.restrict(filter)` applies an allow or deny mask to the global tools one agent inherits; masks intersect, scoped registrations stay visible”
- `@deepseek-ai/dsh-tools/src/index.ts`：`restrict()` 需要 scoped context；`view()` 的 `inherited` / `restrictableNames`
- `@deepseek-ai/dsh-tools/src/events.ts`：`tools/pre-execute` 是 scope-filtered waterfall

### 2.6 会话状态与投影

`@deepseek-ai/dsh-plan-mode` 给出了同类模式所需状态的完整实现范式：

- 一个 log-only 的 whole-value 事件（`plan/mode`）。
- 一个 `sessionProjections.register()` 的投影单元，在 `apply` 中折叠事件，向客户端发布 `wire.view`。
- `agent/pre-step` 中追加 pending 状态，避免在 open turn 中直接 append 引发重入。
- `/plan` 命令与 `ctx.planMode` service。

对话模式可以复用同一范式，但状态更简单：

- 事件：`chat-mode/tools`，payload `{ shell: boolean, webSearch: boolean }`。
- 投影键：`chatMode`，wire view 同为 `{ shell, webSearch }`。
- 初始值：`{ shell: false, webSearch: false }`。
- 命令：`/chat-tools shell on|off`、`/chat-tools search on|off`。
- open turn 期间：先更新内存中的 pending 选择；restriction 立即按 pending 调整；事件在下一个 accepted in-turn `agent/pre-step` 追加。无 open turn 时立即 append。
- resume/fork：投影从日志折叠恢复；`agent/created` 后按恢复的状态应用 restriction。

`ProjectionDefinition.stateSchema` 在运行期只要求 `.parse(value)`；计划模式使用 zod，但我们的插件可以传一个极简的 `{ parse(value) { return value } }`，避免引入 `zod` 依赖。`wire.viewSchema` 同理。

**证据**：

- `@deepseek-ai/dsh-plan-mode/src/index.ts`：`planProjectionDefinition`、`set()`、`hasOpenTurn()`、`onBoundary()`、`agent/pre-step` listener
- `@deepseek-ai/dsh-session-projection/src/index.ts`：`ProjectionDefinition`、`stateSchema`、`wire`；运行期 `def.stateSchema.parse(row.val)`
- `@deepseek-ai/dsh-session-projection/src/index.ts` 第 216 行附近：`stateSchema: { parse(value: unknown): unknown }`

### 2.7 客户端接入

可用插槽与数据：

| 插槽/数据 | 用途 | 证据 |
| --- | --- | --- |
| `conversation.input.left`（list，session scope） | 放置对话模式的权限下拉与工具开关 | Client Slots `listSubTree` |
| `conversation.input.permission`（single，session scope） | shipped 权限控件；chat 会话中用 CSS 隐藏 | Client Slots `listSubTree`；`@deepseek-ai/dsh-client-ui-permission-presets/src/client/index.ts` |
| `useProjection('permissions')` | 读取当前权限预设 | 同上 |
| `useProjection('chatMode')` | 读取对话模式的工具启用状态 | 由我们的 preset 插件注册 |
| `useSessions(state => state.byId[sessionId]?.projectionValues?.agentPreset)` | 判断当前会话是否 `chat` | `@deepseek-ai/dsh-client-ui-agent-preset/src/client/AgentPresetLabel.tsx` |
| `sessions.binding(sessionId)?.session.command(line)` | 提交 `/permission ...`、`/chat-tools ...` | `@deepseek-ai/dsh-client-ui-permission-presets/src/client/index.ts` |
| `data-slot="<slotKey>"` | 插槽锚点，用于 chat 会话中隐藏 shipped 权限控件 | `@deepseek-ai/dsh-client-ui-renderer/src/client/scoped-slots.tsx` 第 1348 行 `Anchor data-slot={slotKey}` |

客户端控件设计：

- 在 `conversation.input.left` 注册一个 `id: 'chat-mode-controls'` 的控件。
- 组件读取 `agentPreset`；非 `chat` 时返回 `null`（但仍执行 hooks）。
- `chat` 时显示两个紧凑下拉框：
  1. **权限**：`仅可查看` / `工作区内修改`；选中后提交 `/permission <name>`。
  2. **工具**：`全部关闭` / `命令执行` / `联网搜索` / `命令 + 联网`；选中后提交 `/chat-tools ...`。
- 使用 `useEffect` 在 chat 会话时给 `document.body` 设置 `data-dsh-chat-mode="1"`，非 chat 时清除。
- 注入一段样式：

```css
body[data-dsh-chat-mode="1"] [data-slot="conversation.input.permission"] {
  display: none !important;
}
```

**说明**：这是对 shipped 控件做“隐藏”而不是“替换”，因为 `conversation.input.permission` 是 single slot，且 shipped 插件已经注册；重复注册会 shadow 其 UI。隐藏 + 自建控件的方案改动最小，但依赖 `data-slot` 锚点这一稳定但版本耦合的约定。备选方案见第四节。

### 2.8 客户端命令与 locale

- 客户端插件通过 `dsh.client` 加载；`client.js` 用 `window.__ModuleLoader__.load({ id, factory(require) { ... } })` 形式。
- `factory` 返回 `{ inject: ['slots', 'sessions', 'locale'], apply(ctx) { ... } }`。
- 控件文本通过 `ctx.locale.register('chatMode', { zh, en })` 注册；slot 注册带 `locale: 'chatMode'`，组件接收 `t`。
- 主题颜色使用已存在的 token：`--dsw-alias-bg-layer-1`、`--dsw-alias-border-l2`、`--dsw-alias-label-primary/secondary`、`--dsw-alias-brand-primary`。

### 2.9 构建系统

工作区要求每个插件自带 `scripts/` 构建系统。对话模式可以做成**零运行时依赖**插件：

- Host 半 `index.js` 不 import 任何包。
- `preset.js` 只使用 Cordis 提供的 `ctx`，不 import `zod`、`defineTool` 等。
- 客户端 `client.js` 只 `require('react')`（baseline 模块表）。
- 因此 `package.json` 不声明 `dependencies`，构建系统走“不建树”分支；`verify` 要求没有 `node_modules/` 与 `deps.lock.json`。

`verify` 的清单要求：

- `type: module`
- `exports` 全部可解析（`.`、`./preset`、`./client`、`./package.json`、`./locale/*.json`）
- `locale/en.json` 存在且 `meta.title` 非空
- `dsh.bundle.patch` 存在且 patch 文本包含包名
- `dsh.client.platform === 'web'`，`dsh.client.inject` 是包名数组
- `icon` 存在且 ≤ 256 KiB（若声明）
- `files[]` 全部存在
- `index.js`、`client.js` 可被 `node --check`
- `scripts/host-contract.mjs` 存在且探针通过
- `scripts/` 与 `build-system/` 参考副本逐字节一致

**证据**：`BUILD-SYSTEM.md`、`dsh-custom-css/scripts/verify.mjs`

### 2.10 system instructions 的参考

工作区内的 `.agents/sample/chat-demo` 是 DeepSeek 官方 Chat 静态网页。其真正用于对话的 system prompt 非常短：

```text
该助手为DeepSeek，由深度求索公司创造。
```

（`src/services/chat/store.ts:38`，注释为“所有生成请求统一携带的助手身份说明”。）

它另有 `latest_reminder`（日期、星期、地区、Web、语言）作为每轮提醒，但不是 system prompt。DSH 的 `dsh-time-context` 已经覆盖时间/时区上下文，因此对话模式的 system prompt 可以保持“身份 + 对话行为规则”的短形态，而不是复制网页端的实现细节。

---

## 三、核心进路

### 3.1 插件形态

新增独立插件目录/包：

```text
dsh-chat-mode/
  package.json          # name: @local/dsh-chat-mode
  cordis.patch.yml      # Host 行 + preset-chat 声明
  index.js              # Host 半：无 import；只做 bundle 身份与探针
  preset.js             # preset scope 插件：投影、命令、restriction、guard、初始权限
  client.js             # 浏览器半：对话设置控件 + 样式
  icon.svg
  locale/en.json
  locale/zh.json
  scripts/              # 由 build-system/sync.mjs 生成
  README.md             # 实施后编写
  FEASIBILITY@0.2.2-rc.3.md
```

`package.json` 关键字段：

```json
{
  "name": "@local/dsh-chat-mode",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./index.js",
    "./preset": "./preset.js",
    "./client": "./client.js",
    "./package.json": "./package.json",
    "./locale/*.json": "./locale/*.json"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "immediately": true,
      "inject": [
        "@deepseek-ai/dsh-client-ui-conversation",
        "@deepseek-ai/dsh-client-ui-slots",
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-api-session-controller"
      ]
    }
  },
  "files": [
    "index.js",
    "preset.js",
    "client.js",
    "cordis.patch.yml",
    "icon.svg",
    "locale/*.json"
  ]
}
```

### 3.2 bundle patch

```yaml
- insert:
    - id: dsh-chat-mode
      name: '@local/dsh-chat-mode'
    - id: preset-chat
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: chat
        name: 对话
        description: 以纯对话为主；默认不读写工作区文件，命令执行与联网搜索需显式启用。
        order: 5
        plugins:
          - ...
```

`id: dsh-chat-mode` 的 Host 行与 `index.js` 导出的 `ENTRY_ID` 必须一致；`verify` 会检查。

### 3.3 preset 插件列表

```yaml
plugins:
  - id: persona
    name: '@deepseek-ai/dsh-persona'
    config:
      prefix: |
        ... 对话模式 system prompt ...
      complete: true
      includeRuntimeContext: true

  - id: time-context
    name: '@deepseek-ai/dsh-time-context'

  - id: tool-fs
    name: '@deepseek-ai/dsh-tool-fs'
    config:
      read: true
      readImage: true
      write: false
      edit: false
      applyPatch: false

  - id: tool-fs-search
    name: '@deepseek-ai/dsh-tool-fs-search'
    config:
      sampleOverCapGlobResults: false

  - id: tool-ask-user
    name: '@deepseek-ai/dsh-tool-ask-user'

  - id: tool-web
    name: '@deepseek-ai/dsh-tool-web'
    config:
      search: true
      fetch: true
      searchTimeoutMs: 60000

  - id: compaction
    name: cordis:group
    group: true
    isolate:
      compaction: true
      toolResultPruner: true
    config:
      - id: compaction-basic
        name: '@deepseek-ai/dsh-compaction-basic'
      - id: command-compact
        name: '@deepseek-ai/dsh-command-compact'
      - id: tool-result-pruner
        name: '@deepseek-ai/dsh-compaction-tool-result-pruner'
        config:
          thresholdChars: 8192
          headChars: 4096
          tailChars: 1024

  - id: persistent-shell
    name: cordis:group
    group: true
    isolate:
      terminals: true
    config:
      - id: pty
        name: '@deepseek-ai/dsh-terminal'
      - id: terminal-bash
        name: '@deepseek-ai/dsh-terminal-bash'
        disabled: !!js process.platform === 'win32'
        config:
          timeoutMs: 300000
      - id: persistent-bash
        name: '@deepseek-ai/dsh-tool-bash-persistent'
        disabled: !!js process.platform === 'win32'
        config:
          timeoutMs: 300000
          description: |-
            Run commands in a persistent bash shell.
            * State is persistent across command calls.
            * Only available after the user explicitly enables command execution in the chat toolbar.
            * Do not use this tool unless the user asked you to run a command.
      - id: terminal-pwsh
        name: '@deepseek-ai/dsh-terminal-bash'
        disabled: !!js process.platform !== 'win32'
        config:
          shellDialect: pwsh
          timeoutMs: 300000
      - id: persistent-pwsh
        name: '@deepseek-ai/dsh-tool-pwsh-persistent'
        disabled: !!js process.platform !== 'win32'
        config:
          timeoutMs: 300000

  - id: chat-mode
    name: '@local/dsh-chat-mode/preset'
```

**顺序**：`chat-mode` 放在工具插件之后，确保它在 `agent/created` 时能看到 `bash`/`web_search` 等工具已注册；投影与命令的注册不依赖顺序，但 restriction 的 `restrictableNames` 检查依赖工具已注册。

### 3.4 `preset.js` 的职责

#### 3.4.1 投影

```js
const projectionHandle = await ctx.sessionProjections.register({
  key: 'chatMode',
  stateVersion: 1,
  stateSchema: { parse: value => value },
  init: () => ({ shell: false, webSearch: false }),
  apply: (state, event) => {
    if (event.type !== 'chat-mode/tools') return state
    return { shell: event.data.shell, webSearch: event.data.webSearch }
  },
  wire: {
    viewSchema: { parse: value => value },
    view: state => ({ shell: state.shell, webSearch: state.webSearch }),
  },
})
```

#### 3.4.2 会话状态与 pending

- `pending: WeakMap<Session, { shell, webSearch }>`。
- `selected(session)` = `pending.get(session) ?? projectionHandle.stateOf(session)`。
- `/chat-tools` 命令：
  - 解析 `shell on|off`、`search on|off`；
  - 计算 next；
  - 更新 `pending`；
  - 立即调用 `applyRestrictions(agent, next)`；
  - 若无 open turn（`ctx.agents.turnBoundaryOf(session).openTurnStartSeq === null`），立即 `session.append('chat-mode/tools', next)` 并清 pending；
  - 否则等待 `agent/pre-step` 追加。
- `agent/pre-step` listener：在 `next()` 确认进入 step 后，追加 pending，返回 decision。

#### 3.4.3 工具 restriction

per agent（`WeakMap<Session, { disposers: Function[], key: string }>`）：

```js
function applyRestrictions(agent, state) {
  const toolCtx = agent.ctx
  const deny = []
  const shellTool = process.platform === 'win32' ? 'pwsh' : 'bash'
  if (!state.shell) deny.push(shellTool)
  if (!state.webSearch) deny.push('web_search')
  // 仅对实际可见/已注册的工具名做 deny
  const visible = deny.filter(name => toolCtx.tools.get(name) !== undefined)
  if (sameAsPrevious) return
  disposePrevious()
  if (visible.length > 0) {
    const dispose = toolCtx.tools.restrict({ deny: visible })
    remember(dispose)
  }
}
```

注意：`toolCtx.tools.get(name)` 在 restriction 生效后会返回 undefined，所以不能用它判断“是否已注册”。应在首次应用前缓存可限制的工具名，或直接用平台判断 + `ctx.tools.get` 的全局视图。实现时用 `toolCtx.tools.schemas(toolCtx)`（不带 toolSet）在 restriction 之前取一次名单，或在 preset 插件 `apply` 时缓存工具名。两种都可以。

#### 3.4.4 兜底 guard

```js
ctx.on('tools/pre-execute', async (exec, next) => {
  const state = selected(exec.agent.session)
  if (isGated(exec.name) && !enabled(state, exec.name)) {
    return {
      kind: 'deny',
      reason: '该工具在对话模式中默认关闭。请用户在输入框左侧的“对话设置”中启用后再试。',
    }
  }
  return next()
})
```

guard 是 preset scope listener，只收到该 preset 下 Agent 的调用。

#### 3.4.5 初始权限

```js
ctx.on('agent/created', ({ agent }) => {
  const session = agent.session
  const current = ctx.permissionPresets.current(session)
  if (current !== 'read-only' && current !== 'workspace-write') {
    ctx.permissionPresets.set(session, 'read-only')
  }
  initializeAgent(agent) // restrictions + command registration
})
```

顺序：

- 全局 `dsh-permission-presets` 的 `pinInitialPermission` 以 `prepend: true` 注册，先写入默认预设；
- 我们的 listener 是普通 listener，后运行；若默认是 `danger-full-access`，强制改为 `read-only`；
- 若 listener 顺序异常，我们的 set 先写入 `read-only`，全局 pin 看到已有事件后不会覆盖。

#### 3.4.6 `/permission` shadow

在 preset scope 注册：

```js
ctx.inject(['commands', 'permissionPresets'], (commandCtx) => {
  commandCtx.commands.register({
    name: 'permission',
    description: 'Switch the permission preset (read-only or workspace-write)',
    input: { hint: 'read-only|workspace-write' },
    handler: ({ agent, rawInput }) => {
      const name = rawInput.trim()
      if (name === '') {
        return {
          kind: 'success',
          text: `current preset ${ctx.permissionPresets.current(agent.session)} (available: read-only, workspace-write)`,
        }
      }
      if (name !== 'read-only' && name !== 'workspace-write') {
        return {
          kind: 'error',
          text: `对话模式只允许 read-only 或 workspace-write；${name} 不可用。`,
        }
      }
      ctx.permissionPresets.set(agent.session, name)
      return { kind: 'success', text: `preset ${name}` }
    },
  })
})
```

若 preset scope 不能 shadow 全局 `/permission`，改为在 `agent/created` 时：

```js
const dispose = agent.ctx.inject(['commands'], (commandCtx) => {
  return commandCtx.commands.register({ ... })
})
// 并把 dispose 挂到 preset 的 effect 上，preset 卸载时移除，避免切走 preset 后残留
```

#### 3.4.7 `/chat-tools` 命令

```js
ctx.inject(['commands'], (commandCtx) => {
  commandCtx.commands.register({
    name: 'chat-tools',
    description: 'Enable or disable advanced tools in chat mode',
    input: { hint: 'shell on|off | search on|off' },
    handler: ({ agent, rawInput }) => {
      // 解析、更新 pending、applyRestrictions、必要时 append
    },
  })
})
```

### 3.5 system instructions

`persona.prefix` 草案：

```text
你是 DeepSeek，由深度求索公司创造的 AI 助手。你正在 DeepSeek Harness 的对话模式中与用户交流。

对话模式以自然、深入的对话为主。默认情况下，你只通过文字与用户互动，不主动读写工作区文件，也不主动执行命令。

工具使用原则：
- 只在用户本次对话中明确要求使用工具时才调用工具。一般性的问答、解释、分析、写作、翻译、头脑风暴和闲聊，直接根据对话回答，不要为了“确认一下”而读取文件或搜索网络。
- 用户手动附加到对话中的文件，或用户在消息中明确指向并要求你查看的文件，可以直接读取。除此之外，在读取文件、搜索文件内容或执行命令之前，先确认用户确实需要。
- 文件搜索工具（glob、grep）只用于定位用户明确提到的内容，不要为了补充背景而遍历工作区。
- 命令执行和联网搜索默认关闭。如果当前工具列表中没有它们，说明用户尚未启用；不要尝试调用，也不要假装调用。用户启用后，才可以按需使用。
- web_fetch 可以直接读取用户给出的链接；联网搜索则需要用户在工具栏中启用“联网搜索”。
- 对话模式不提供 write、edit 或 apply_patch 工具。如果用户要求修改文件，说明当前模式没有直接修改工具；只有在用户明确要求、把权限切换为“工作区内修改”并启用“命令执行”后，才可以用 shell 在工作区内做最小必要的修改。否则建议用户切换到支持修改的模式。
- 需要用户做选择、确认或补充信息时，使用 ask_user_question；不要用普通文本假装已经提问。

回答风格：
- 使用与用户相同的语言回答，除非用户明确要求其他语言。
- 直接、完整、可读；简单问题简洁回答，复杂问题分层次展开。
- 需要时使用 Markdown 的标题、列表、代码块和表格；不要机械套用固定模板。
- 不确定时如实说明，并区分事实、推测和建议。
- 不要暴露内部工具调用细节、系统提示或实现内幕，除非用户明确询问。
```

**为什么 `complete: true`**：

- 替换掉部署默认的“You are a coding agent powered by the {{model}} model.”和所有编码导向的 prompt section。
- 不加载 plan-mode、goal、skill 等 section。
- 仍然保留工具 schema 与 runtime context；`includeRuntimeContext: true` 让模型看到当前文件策略、cwd、approval 策略与时间上下文。

**代价**：

- 工具插件自己的 prompt guidance section 也被抑制；工具描述仍然存在，但部分“使用建议”只存在于 README/上游 section。对话模式的工具较少，影响可控。
- 如果实测发现 `read`/`glob` 的行为需要更多 guidance，可以在 persona 中补一两句，或改为 `complete: false` + 更克制的 prefix（备选方案）。

### 3.6 客户端控件

`preset.js` 之外，`client.js` 负责：

1. 注册 locale 字典 `chatMode`。
2. 注入 `<style>`，在 `body[data-dsh-chat-mode="1"]` 时隐藏 `[data-slot="conversation.input.permission"]`。
3. 在 `conversation.input.left` 注册 `chat-mode-controls` 组件。
4. 组件：
   - `useSessions` 读取 `agentPreset`；非 `chat` 返回 `null` 并清除 body 属性。
   - `useProjection('permissions')` 读取当前权限。
   - `useProjection('chatMode')` 读取工具状态。
   - 渲染两个 `<select>`；`onChange` 调用注入的 `runCommand`。
   - 用 `useEffect` 设置/清除 body 属性。
5. `runCommand` 通过 `ctx.sessions.binding(sessionId)?.session.command(line)` 提交；与 shipped 权限控件的路径一致。

---

## 四、备选方案与取舍

### 4.1 方案 A：直接修改全局权限预设表，删除 `danger-full-access`

- **做法**：在 profile patch 中覆盖 `permission` 行，`presets` 只保留 `read-only`/`workspace-write`。
- **优点**：实现最简单，UI 自然只显示两个选项。
- **缺点**：影响所有模式；用户在其他模式下失去完全权限。与“选定对话模式时锁定”的要求不符。
- **结论**：不采用。

### 4.2 方案 B：只做 Host 端拒绝，不改 UI

- **做法**：shadow `/permission`，拒绝 `danger-full-access`；不隐藏 shipped 控件。
- **优点**：改动最小，不依赖 CSS/UI 插槽。
- **缺点**：下拉框仍显示“完全权限”，用户选择后收到错误；体验不符合“不允许选择”。
- **结论**：作为 fallback；主方案做 UI 过滤。

### 4.3 方案 C：替换 shipped 权限客户端插件

- **做法**：disable `ui-permission-presets`，复制/重写其 `/permission` decoration、`conversation.input.permission` 控件与 General settings row，按 `agentPreset` 过滤选项。
- **优点**：最干净，没有 CSS 隐藏；所有入口一致。
- **缺点**：需要复制 shipped 的 React 组件、catalog directory、locale、risk confirmation；与 DSH 版本强耦合，维护成本高。
- **结论**：暂不作为首版；若用户不能接受方案 B 的 slash picker 残留，可升级为此方案。

### 4.4 方案 D：隐藏 shipped 控件 + 自建控件（本方案）

- **做法**：body 属性 + CSS 隐藏 `conversation.input.permission`；在 `conversation.input.left` 自建两个下拉框；Host shadow `/permission` 兜底。
- **优点**：改动可控；非 chat 会话完全不受影响；服务端保证权限不被绕过。
- **缺点**：
  - 依赖 `data-slot` 锚点，属于版本耦合的 UI 约定；
  - `/permission` slash picker 仍显示 shipped 选项（选择后会被 Host 拒绝）；
  - 需要维护自定义控件的 locale/主题。
- **结论**：首版采用。文档中明确 limitation。

### 4.5 工具按需启用的备选

| 方案 | 优点 | 缺点 |
| --- | --- | --- |
| `tools.restrict()`（本方案） | 真正隐藏 schema；复用 shipped 工具；可动态开关 | 需要 `agent.ctx`；需在 preset 卸载时清理 |
| `tools/pre-execute` deny | 实现简单；可给模型明确提示 | schema 仍可见；模型可能反复尝试 |
| 动态 mount/unmount 工具插件 | 最彻底 | 需要 import `dsh-tool-*` 包、管理 plugin 生命周期；依赖与构建成本高 |
| `register(..., { when })` | 官方条件工具 | shipped 工具没有暴露 `when` 入口 |

### 4.6 system prompt 的备选

| 方案 | 优点 | 缺点 |
| --- | --- | --- |
| `complete: true` + runtime context（本方案） | 彻底摆脱编码 Agent 身份；prompt 稳定 | 抑制工具 guidance section |
| `complete: false` + chat prefix | 保留工具 guidance/plan/goal 等 section | 默认编码身份和无关 section 仍会出现 |
| 只改 `suffix` | 改动小 | 无法去掉默认身份 |

---

## 五、问题与解决办法

### 5.1 preset scope 与 agent scope

**症状**：在 preset 作用域注册的 `/permission` 可能不能 shadow 全局 `/permission`。

**根因**：`dsh-commands` README 强调“mounted beneath an agent's own context”，而 preset scope 是 Agent scope 的祖先，不是子节点。

**修法**：

- 首选在 preset scope 注册，代码阶段用 `ctx.commands.find(agent, 'permission')` 验证解析结果是否为我们注册的 handler。
- 若不能 shadow，回退到 `agent/created` 时通过 `agent.ctx.inject(['commands'], child => child.commands.register(...))` 注册；把返回的 disposer 挂到 preset 的 `ctx.effect` 清理函数上，避免切换 preset 后残留。

### 5.2 `tools.restrict()` 对 ancestor 工具的可见性

**症状**：不确定 `agent.ctx.tools.restrict({ deny: ['bash'] })` 是否能隐藏 preset 作用域注册的 `bash`。

**根因**：README 说“scoped registrations stay visible”，但源码 `view()` 把 `own` 之外的祖先层都放进 `inherited`，`restrictableNames` 来自 `inherited`。

**修法**：

- 代码阶段先打印 `agent.ctx.tools.schemas(agent.ctx)`，确认 `bash`/`web_search` 可见；再调用 restrict，再打印确认消失。
- 若 restriction 不生效，改用 `tools/pre-execute` deny（schema 仍可见），并在 README/limitations 中说明。
- 不要把 `bash`/`web_search` 注册在 agent 自己的 scope（那样一定不会被 restrict）。

### 5.3 初始权限 pin 的顺序

**症状**：chat 会话可能继承全局默认的 `danger-full-access`。

**根因**：`dsh-permission-presets` 的 `pinInitialPermission` 用 `prepend: true` 注册；若用户的 `permission.defaultPreset` 是 `danger-full-access`，新 chat 会话会先得到完全权限。

**修法**：

- 在 `agent/created` 的普通 listener 中读取 `permissionPresets.current(session)`；若不在允许集合内，调用 `set(session, 'read-only')`。
- 该操作是幂等的；即使 listener 顺序异常，也能收敛到允许集合。
- 不在 `agent/created` 无条件 `set('read-only')`，否则会覆盖用户已保存的 `workspace-write` 选择（resume 场景）。

### 5.4 resume / fork

**症状**：恢复或 fork 的会话可能丢失工具启用状态或权限。

**根因**：内存 `pending` 不持久化；fork 会复制日志，但新的 Agent 需要重新应用 restriction。

**修法**：

- 工具启用状态走 `chat-mode/tools` 事件 + `chatMode` 投影；resume/fork 自动折叠。
- `agent/created` 时从投影初始化 restriction；若状态是 `shell: true`，不应用对应 restriction。
- fork 的权限由 `dsh-permission-presets` 的 projection/pin 机制处理；我们的 `agent/created` 检查同样覆盖 fork。

### 5.5 open turn 中的状态更新

**症状**：用户在模型正在运行时切换工具开关，直接 `session.append` 可能引发重入或顺序问题。

**根因**：`Session.append` 在 open turn 中的语义与 `agent/pre-step` 不同；plan-mode 的选择是等待下一个 accepted in-turn pre-step。

**修法**：

- 复用 plan-mode 的 `hasOpenTurn` + `pending` + `agent/pre-step` 模式。
- restriction 立即按 pending 调整，保证用户切换后下一次工具解析生效；事件延迟追加。
- 客户端在命令提交后做乐观更新，投影更新后同步。

### 5.6 CSS 隐藏 shipped 权限控件

**症状**：`[data-slot="conversation.input.permission"]` 是 renderer 的实现细节，未来版本可能改名。

**修法**：

- 首版接受该耦合，并在 README 的 limitations 中记录。
- 代码中把选择器集中在一个常量，便于版本升级时修改。
- 若锚点消失，控件仍能通过 Host shadow 拒绝完全权限；只是 UI 会重新显示 shipped 控件。
- 备选：升级为方案 C（完整替换 shipped 权限客户端插件）。

### 5.7 slash `/permission` picker 仍显示完全权限

**症状**：用户输入 `/permission` 时，shipped slash picker 从进程 catalog 读取选项，仍列出 `danger-full-access`。

**修法**：

- Host shadow 命令拒绝该值，并返回明确错误；
- 文档说明：推荐使用输入框左侧的“对话设置”下拉框；
- 若必须彻底移除，采用方案 C。

### 5.8 `complete: true` 抑制工具 guidance

**症状**：工具插件贡献的 prompt guidance 被 persona 的 complete 模式替换掉，模型可能不知道某些工具的最佳用法。

**修法**：

- 工具 schema 本身包含描述；
- 在 persona 中写清楚对话模式的工具使用规则；
- 若实测发现 `read`/`glob` 的使用质量下降，改为 `complete: false`，用 chat prefix 覆盖身份，同时保留 guidance。

### 5.9 平台差异

**症状**：Windows 上 `bash` 不存在，`pwsh` 存在；restriction 若写死 `bash` 会报 unknown tool。

**修法**：

- 用 `process.platform` 选择 `bash`/`pwsh`；
- 在 apply restriction 前用 `agent.ctx.tools.schemas(agent.ctx)` 确认名字存在；
- 保持 minimal 原有的 `!!js process.platform` disabled 条件。

### 5.10 激活审计与依赖

**症状**：preset 插件激活失败（缺失 service / 全局泄漏）。

**修法**：

- `preset.js` 的 `inject` 只声明实际使用的 Host service：`sessionProjections`、`commands`、`permissionPresets`、`agents`、`tools`。
- 不注册任何自定义 service；状态用模块级 `WeakMap` + 投影。
- 零 import，避免 profile 不提供依赖包的问题。
- 若需要 `zod`/`defineTool`，再通过构建系统 pin 依赖；首版不需要。

### 5.11 “preset 不是安全沙箱”

**症状**：用户可能把权限锁理解为不可绕过的安全边界。

**修法**：

- README 明确：preset 是功能与策略组合，不是安全沙箱；DSH 官方文档也指出 presets “are not security sandboxes”。
- 权限锁通过命令 shadow + 初始 pin 实现；模型的一次性权限申请仍可触及更宽模式，这是刻意保留的能力。
- 真正的文件限制来自 sandbox policy 与 approval；对话模式只是把允许的预设限制在两个 confined 模式。

---

## 六、实施步骤（下一轮代码工作）

1. **创建插件骨架**
   - `mkdir dsh-chat-mode` 已存在；
   - `node ../build-system/sync.mjs dsh-chat-mode`（在 `local-plugins/` 下）生成 `scripts/` 与 `scripts/host-contract.mjs`。
2. **package.json**
   - 按 3.1 写 `name`、`version`、`exports`、`dsh`、`files`、`scripts`、`engines`、`peerDependencies`。
   - 不声明 `dependencies`。
3. **cordis.patch.yml**
   - Host 行 `dsh-chat-mode`；
   - `preset-chat` 声明与 3.3 的插件列表。
4. **index.js**
   - 零 import；导出 `ENTRY_ID = 'dsh-chat-mode'`、`name`、`apply()`（可空）。
5. **preset.js**
   - 注册 `chatMode` 投影；
   - `agent/created`：初始权限检查、restriction 初始化、`/permission` shadow（或 agent-scope 回退）；
   - `agent/pre-step`：追加 pending；
   - `tools/pre-execute`：兜底 deny；
   - `/chat-tools` 命令；
   - helper：`applyRestrictions`、`selected`、`isGated`。
6. **client.js**
   - locale 字典；
   - 注入样式；
   - `conversation.input.left` 控件；
   - body 属性与清理；
   - 命令提交。
7. **资源与文档**
   - `locale/en.json`、`locale/zh.json`（`meta.title`）；
   - `icon.svg`；
   - `README.md`（一句话、使用与效果、工作原理、依赖与构建、适用范围与边界、故障排查、版本契约；首行 `最后实质性修改于Harness版本：0.2.2-rc.3`）。
8. **构建检查**
   - `npm run build`；
   - `npm run verify`；
   - 按 `BUILD-SYSTEM.md` 跑参考副本检查。
9. **安装与验收**
   - `plugin_manager` `install_bundle` 指向插件目录（需要 Full access/审批）；
   - `list_bundles` / `list_plugins` 确认 `preset-chat` 激活；
   - 新建 chat 会话验证；
   - 如果插件变更需要重启 DSH 才生效，按 AGENTS.md 规则停止并提示用户重启，不自行绕过。

---

## 七、验证与验收

### 7.1 预设与组合

- [ ] `plugin_manager list_bundles` 显示 `@local/dsh-chat-mode`。
- [ ] `list_plugins` 显示 `preset-chat`，激活状态正常，无 diagnostic。
- [ ] 新会话花名册出现“对话”（order 5）。
- [ ] `@deepseek-ai/dsh-agent-preset-registry` 的 `read` 能列出 chat 的插件组合。

### 7.2 工具清单

新建 chat 会话后，模型工具列表应包含：

- `read`、`read_image`
- `glob`、`grep`
- `web_fetch`
- `ask_user_question`

默认不包含：

- `bash`（posix）/ `pwsh`（Windows）
- `web_search`

默认不包含且不应出现：

- `write`、`edit`、`apply_patch`
- `office_*`、`present`、`skill`、`todo_write`、`subagent*`、`workflow`、`goal`、`schedule_*`、`job_*`

### 7.3 权限锁定

- [ ] chat 会话的输入框左侧显示“对话设置”控件；shipped 权限控件被隐藏。
- [ ] 权限下拉只有“仅可查看”和“工作区内修改”。
- [ ] 选择“仅可查看”后，`permissions` 投影显示 `read-only`。
- [ ] 选择“工作区内修改”后，显示 `workspace-write`。
- [ ] `/permission danger-full-access` 返回错误，且会话权限不变。
- [ ] 把全局默认权限设为“完全权限”，新建 chat 会话仍被 pin 到允许集合（不是 full access）。
- [ ] 非 chat 会话的权限控件仍然显示完全权限，且选择有效（不受影响）。

### 7.4 一次性权限申请

- [ ] 在 `read-only` 且 shell 已启用时，让 Agent 执行一个写文件命令；应得到 sandbox 拒绝与 escalation 提示。
- [ ] 模型可以带 `sandbox_permissions` + `justification` 重试；用户批准后该次调用成功。
- [ ] 调用结束后会话权限仍为 `read-only`（一次性，不持久化）。

### 7.5 工具按需启用

- [ ] 默认工具列表无 `bash`/`web_search`。
- [ ] 在“对话设置”中启用“命令执行”，下一个 step 的工具列表出现 `bash`（Windows 为 `pwsh`）。
- [ ] 关闭后，下一个 step 的工具列表移除；已解析但未执行的旧 batch 调用被 guard 拒绝并给出提示。
- [ ] 启用“联网搜索”后出现 `web_search`；关闭后消失。
- [ ] 状态在 resume/fork 后保持（通过 `chatMode` 投影）。

### 7.6 system prompt

- [ ] 新会话第一条请求的 system prompt 只有 persona 文本（complete 模式）。
- [ ] 运行时上下文包含文件策略、cwd、时间上下文。
- [ ] 模型在普通问答中不主动读文件/执行命令。
- [ ] 用户说“看看这个文件”时，模型会读取（在 read-only 下 `read` 可用）。
- [ ] 用户要求改文件时，模型说明对话模式没有 write/edit，并给出切换/启用建议。

### 7.7 客户端与本地化

- [ ] 中文界面显示“对话设置 / 仅可查看 / 工作区内修改 / 工具”等中文文案。
- [ ] 英文界面显示对应英文文案。
- [ ] 主题切换（亮/暗）下控件颜色正常。
- [ ] 非 chat 会话不显示控件的任何残留；body 属性被清除。
- [ ] 页面刷新后控件与状态正常。

### 7.8 构建与文档

- [ ] `npm run build` 成功。
- [ ] `npm run verify` 成功，含 Host 探针。
- [ ] `README.md` 与代码一致。
- [ ] 本 FEASIBILITY 文档追加“实施记录”和“验证结果”。

---

## 八、已确认决策（2026-11-17）

用户已确认以下首版行为：

1. **默认权限**：Chat 新会话使用 `read-only`。实现上在 `agent/created` 中根据 `source === 'startup'` 强制 `read-only`；恢复的会话保留已保存的 `read-only` / `workspace-write`，更宽权限纠正为 `read-only`。
2. **`read` / `glob` / `grep` 默认状态**：不关闭。它们始终出现在工具列表中，由 system prompt 约束为“只在用户明确要求时使用”。
3. **`web_fetch` 默认状态**：不关闭。只有 `web_search` 默认被 restrict 隐藏。
4. **预设显示名与顺序**：英文 `Chat`，`order: 5`。
5. **CSS 隐藏**：接受。Chat 会话中隐藏 shipped `conversation.input.permission`，改在 `conversation.input.left` 自建两个下拉框。
6. **`tool-result-pruner`**：加入。
7. **切换预设**：首版只考虑新建会话；不支持在已有会话中切换到 Chat 后即时重建权限命令/restriction。

实现记录见第十节。

---

## 九、证据索引

### 9.1 预设与组合

- `@deepseek-ai/dsh-web-app/presets/minimal.patch.yml`
- `@deepseek-ai/dsh-web-app/presets/standard.patch.yml`
- `@deepseek-ai/dsh-agent-preset/README.md`
- `@deepseek-ai/dsh-agent-preset-registry/README.md`
- `@deepseek-ai/dsh-agent-preset-registry/src/index.ts`：`presetForSession`、`select`、`inspectCompositions`
- `@deepseek-ai/dsh-agent/src/index.ts`：`setup` 文档（child plugins before `agent/created`）

### 9.2 权限

- `@deepseek-ai/dsh-base/cordis.patch.yml`：`permission` 行（read-only/workspace-write approval `ask`；danger-full-access approval `never`）
- `@deepseek-ai/dsh-permission-presets/README.md`
- `@deepseek-ai/dsh-permission-presets/src/index.ts`：`Config`、`catalog()`、`set()`、`pinInitialPermission()`
- `@deepseek-ai/dsh-client-ui-permission-presets/README.md`
- `@deepseek-ai/dsh-client-ui-permission-presets/src/client/index.ts`
- `@deepseek-ai/dsh-user-approval/README.md`（approval policy 与 escalation）
- `@deepseek-ai/dsh-tool-fs/README.md`（`sandbox_permissions` / `justification` 重试）
- `@deepseek-ai/dsh-tool-bash/README.md`（confined executor 的 escalation）

### 9.3 工具

- `@deepseek-ai/dsh-tools/README.md`：`restrict`、`pre-execute`、`when`
- `@deepseek-ai/dsh-tools/src/index.ts`：`restrict()`、`view()`
- `@deepseek-ai/dsh-tools/src/events.ts`：`tools/pre-execute`
- `@deepseek-ai/dsh-tool-fs/README.md`：`read`/`readImage`/`write`/`edit`/`applyPatch` 开关
- `@deepseek-ai/dsh-tool-fs-search/README.md`：`glob`/`grep`、`sampleOverCapGlobResults`
- `@deepseek-ai/dsh-tool-web/README.md` / `src/index.ts`：`search`/`fetch` 开关
- `@deepseek-ai/dsh-tool-ask-user/README.md`
- `@deepseek-ai/dsh-tool-bash-persistent/README.md`：`bash` 工具名与 `timeoutMs`
- `@deepseek-ai/dsh-tool-pwsh-persistent/README.md`
- `@deepseek-ai/dsh-terminal/README.md` / `@deepseek-ai/dsh-terminal-bash/README.md`

### 9.4 会话状态与投影

- `@deepseek-ai/dsh-plan-mode/src/index.ts`：`planProjectionDefinition`、`set()`、`hasOpenTurn()`、`onBoundary()`、`agent/pre-step`
- `@deepseek-ai/dsh-session-projection/README.md`
- `@deepseek-ai/dsh-session-projection/src/index.ts`：`ProjectionDefinition`、`stateSchema`、`wire`
- `@deepseek-ai/dsh-commands/README.md`：scoped commands 与 shadow
- `@deepseek-ai/dsh-commands/src/index.ts`：`register()`、`view()`

### 9.5 客户端

- Client Slots `listSubTree`（`conversation.input.left`、`conversation.input.permission`）
- `@deepseek-ai/dsh-client-ui-renderer/src/client/scoped-slots.tsx`：`Anchor data-slot={slotKey}`
- `@deepseek-ai/dsh-client-ui-agent-preset/src/client/AgentPresetLabel.tsx`：`projectionValues.agentPreset`
- `@deepseek-ai/dsh-client-ui-conversation/src/client/skeleton/InputBar.tsx`：`useProjection('plan')` 等
- `@deepseek-ai/dsh-client-ui-permission-presets/src/client/index.ts`：`sessions.binding(sessionId)?.session.command()`
- Client Theme `listTokens`：`--dsw-alias-*`

### 9.6 system prompt 参考

- `.agents/sample/chat-demo/src/services/chat/store.ts:38`：`const SYSTEM_PROMPT = '该助手为DeepSeek，由深度求索公司创造。'`
- `.agents/sample/chat-demo/src/services/chat/store.ts`：`serverTools`（`deepseek_read_url` 始终开启，`deepseek_web_search` 由开关控制）
- `.agents/sample/chat-demo/src/services/chat/latestReminder.ts`：日期/星期/地区/语言提醒（DSH 由 `time-context` 覆盖）

### 9.7 构建与文档

- `BUILD-SYSTEM.md`
- `dsh-custom-css/scripts/verify.mjs`
- `dsh-custom-css/package.json`
- `AGENTS.md`

---

## 十、实施记录（2026-11-17）

### 10.1 产物

插件目录 `local-plugins/dsh-chat-mode/`：

| 文件 | 作用 |
| --- | --- |
| `package.json` | `@local/dsh-chat-mode@1.0.0`，无运行时依赖；`exports` 含 `.` / `./preset` / `./client` / `./locale/*.json` |
| `cordis.patch.yml` | Host 行 `dsh-chat-mode` + `preset-chat` 声明 |
| `index.js` | 零 import 的 Host 半；导出 `ENTRY_ID`、`name`、`apply` |
| `preset.js` | preset 作用域插件：`chatMode` 投影、初始权限、Agent 作用域 `/permission`、`/chat-tools`、`tools.restrict()`、`tools/pre-execute` guard |
| `client.js` | `conversation.input.left` 控件、shipped 权限 seat 隐藏、中英文 locale |
| `locale/en.json` / `locale/zh.json` | 插件详情页标题与描述 |
| `icon.svg` | 对话气泡图标 |
| `README.md` | 使用、原理、构建、边界、故障排查、版本契约 |
| `scripts/` | 构建系统参考副本 + 本插件的 `host-contract.mjs` + `test.mjs` |

### 10.2 构建与验证

- `npm run build`：通过（`verify · all checks passed`）。
- `npm run verify`：通过，包含：
  - 目录无符号链接 / Finder 替身 / macOS sidecar；
  - 无 `node_modules/`、无 `deps.lock.json`；
  - `exports`、`dsh.bundle.patch`、`dsh.client`、locale 锚点、icon、`files[]`；
  - `index.js` / `client.js` parse；
  - `npm test`（`scripts/test.mjs`）；
  - Host 探针（entry id、patch 形状、preset id/order、工具开关、preset 子路径）。
- `npm test`：7 组逻辑断言通过（权限 pin、restriction、投影 fold、`/permission` 拒绝、`/chat-tools`、open turn pending、pre-execute guard）。

### 10.3 运行时集成验证

为验证真实 Host 行为，在 `/tmp` 创建了临时 `web` profile（`DSH_HOME=/tmp/dsh-chat-test-home`）并加入：

- `@local/dsh-chat-mode`（本插件）；
- `@local/dsh-chat-probe`（临时探针，**不在**本插件目录，不进入交付物）。

探针调用 `ctx.sessionController.create({ cwd, agentPreset: 'chat' })`，再读取真实 Agent 的：

- `ctx.agentPresets.presetForSession(session)`；
- `ctx.permissionPresets.current(session)`；
- `ctx.tools.schemas(agent)`；
- `ctx.commands.find(agent, 'permission')` / `find(agent, 'chat-tools')`。

结果：

```json
{
  "created": { "agentPreset": "chat" },
  "preset": "chat",
  "permission": "read-only",
  "tools": [
    "ask_user_question", "glob", "grep", "read", "read_image",
    "team_task_create", "team_task_get", "team_task_list", "team_task_update",
    "web_fetch", "working_directory"
  ],
  "hasPermissionCommand": true,
  "hasChatToolsCommand": true,
  "fullRefusal": {
    "kind": "error",
    "text": "Chat mode only allows read-only or workspace-write; \"danger-full-access\" is unavailable."
  },
  "enable": { "kind": "success", "text": "chat tools: shell=on, web_search=off" },
  "afterEnable": [
    "ask_user_question", "bash", "glob", "grep", "read", "read_image",
    "team_task_create", "team_task_get", "team_task_list", "team_task_update",
    "web_fetch", "working_directory"
  ],
  "disable": { "kind": "success", "text": "chat tools: shell=off, web_search=off" },
  "afterDisable": [
    "ask_user_question", "glob", "grep", "read", "read_image",
    "team_task_create", "team_task_get", "team_task_list", "team_task_update",
    "web_fetch", "working_directory"
  ]
}
```

关键结论：

- **新 Chat 会话权限为 `read-only`**。
- **`bash` / `web_search` 默认不在工具列表中**；`write` / `edit` / `apply_patch` 也不在。
- **`/permission` Agent 作用域命令成功 shadow 全局命令**，并拒绝 `danger-full-access`。
- **`/chat-tools mode shell` 立即让 `bash` 出现在工具列表**；`mode off` 立即移除。`tools.restrict()` 对 preset 祖先工具生效。
- `web_fetch` 始终可见；`read` / `read_image` / `glob` / `grep` / `ask_user_question` 始终可见。
- Host 级 `team_task_*` 与 `working_directory` 由基础组合提供，所有预设继承；它们不做文件内容读写，首版保留。

### 10.4 客户端验证

- `cordis_inspect_query` 的 Client Slots 显示 `conversation.input.left` 的 occupant `chat-mode-controls` 已注册且 active，说明 `client.js` 已加载、`Menu` 等 baseline 模块可用。
- 视觉/交互验证需要在 Desktop GUI 中新建 Chat 会话，确认：
  - 输入框左侧出现“权限 / 工具”两个下拉框；
  - shipped 权限控件被隐藏；
  - 权限下拉只有 `仅可查看` / `工作区内修改`；
  - 工具下拉的四项与模型工具列表同步；
  - 中英文文案正确。
- 本次未使用浏览器自动化，上述视觉项作为交付后用户验收项保留。

### 10.5 已知偏差与注意事项

1. **`.agents/sample/chat-demo/node_modules` 已移出插件根目录**：构建系统的 layout 检查要求插件根目录内没有符号链接；该参考项目的 pnpm `node_modules` 含 658 个符号链接。已移动到 `/tmp/dsh-chat-mode-chat-demo-node_modules`，源码仍在 `.agents/sample/chat-demo`。如需重新运行参考项目，在其目录执行 `pnpm install`。
2. **macOS `.DS_Store`**：`.agents` 参考源码会生成 sidecar；`npm run build` 会清理，但 `npm run verify` 单独运行前需确保没有新生成的 `.DS_Store`。
3. **临时探针**：`@local/dsh-chat-probe` 只服务于 `/tmp/dsh-chat-test-home` 的临时 profile，不在本插件目录，不进入交付物，也不影响 Desktop profile。
4. **Desktop profile 安装**：已通过 `plugin_manager install_bundle` 安装 `@local/dsh-chat-mode`；`preset-chat` 为 active。安装/重载客户端半后可能需要刷新页面；如插件管理器提示 `restart-required`，应重启 DSH。
5. **首版限制**：中途切换 preset、shipped slash picker 仍显示完全权限、CSS 隐藏依赖 `data-slot` 锚点；均已在 README 记录。

### 10.6 后续可选增强

- 支持在已有会话中切换到 Chat 时重建 Agent 作用域 `/permission` 与 restriction（处理 `agent-preset/selected`）。
- 若需要彻底移除 slash picker 的完全权限行，可替换 shipped `ui-permission-presets` 客户端插件（成本较高）。
- 若希望进一步收紧 Host 级 `team_task_*` / `working_directory`，可在 Chat Agent 作用域追加 `restrict()`。
- 若实测 `complete: true` 抑制 tool guidance 影响体验，可改为 `complete: false` + 更克制的 chat prefix。

---

## 十一、工具多选菜单与下拉框外观优化（2026-11-17）

### 11.1 目的与范围

本轮只改客户端控件，不改 Host 半、preset 组合、权限锁与工具 gate：

1. 把“工具”从 **单选四模式**（全部关闭 / 命令执行 / 联网搜索 / 命令 + 联网）改为 **多选菜单**，只保留两个菜单项：
   - **持久终端**（对应 `chatMode.shell`，模型工具 `bash` / `pwsh`）；
   - **联网搜索**（对应 `chatMode.webSearch`，模型工具 `web_search`）。
   - 勾选任意一项即启用该工具，可同时勾选；两项都不勾选即全部关闭。
   - 菜单是数据驱动的（`TOOL_ITEMS` 数组），为未来增加工具留出扩展位。
2. 优化两个下拉框的外观：
   - 工具菜单项与触发器增加图标；
   - 权限菜单项与触发器增加图标；
   - 触发器改为带主题 token 的胶囊式按钮，增加 hover / focus-visible / active / disabled 状态与 chevron 旋转；
   - 保留 `portal` 弹出层与 shipped `Menu` 的键盘/焦点行为。

### 11.2 可行性

#### 11.2.1 `Menu` 原生支持多选

前端 primitives 的 `Menu` 组件（压缩 bundle 中的 `zp`）的 props 包含：

```text
selectedId, selectedIds, selection = 'check', items, onSelect, onClose,
anchor, align, side, portal, dense, compact, autoFocus, footer, ...
```

其中 item 的选中判断为：

```text
selected: item.id === selectedId || selectedIds?.includes(item.id) === true
selection: selection
```

`MenuItemButton`（`Zu`）在 `selected && selection === 'check'` 时渲染 check 图标，`selection === 'fill'` 时使用填充式选中样式。默认 `selection: 'check'`，正是多选需要的勾选样式。

**关键行为**：item 的 `onClick` 只调用 `onSelect(item.id)`，不会自动调用 `onClose`；`Menu` 的关闭由父组件的 `open` 状态或外部点击/取消控制。因此：

- 工具菜单传入 `selectedIds`，`onSelect` 切换对应状态并保持 `open: true`，菜单不会关闭，可以连续勾选两项。
- 权限菜单继续使用 `selectedId`，`onSelect` 后主动 `setPermissionOpen(false)`。

**证据**：

- `dsh-web-frontend/dist/assets/index-Ciz7DZxv.js` 中 `function zp({...})` 的 `selectedIds` / `selection` / item 渲染逻辑；
- 同一 bundle 的 primitives 导出表包含 `Menu`、`MenuItemButton`、`MenuSurface`、`MENU_TRANSITION_MS`。

#### 11.2.2 可用图标

primitives 导出表中确认存在：

| 用途 | 图标导出 |
| --- | --- |
| 权限：仅可查看 | `PermissionIconReadOnlyRegular` |
| 权限：工作区内修改 | `PermissionIconWorkspaceWriteRegular` |
| 工具：持久终端 | `IconCodeOutlineRegular`（现有图标集中没有专用 terminal outline；code 图标最接近，也可用 `PluginArtworkTerminal`，但它更适合插件详情页） |
| 工具：联网搜索 | `IconGlobeOutlineRegular`（语义为网络/全球；`IconSearchOutlineRegular` 也可，作为备选） |
| 工具触发器 | `IconSlidersTwoOutlineRegular` |
| chevron | `IconChevronDownOutlineRegular` |

所有图标都通过 `require('@deepseek-ai/dsh-client-ui-primitives')` 获取，沿用 shipped `PermissionSelect` 的图标用法；`Menu` item 的 `icon` prop 直接接收 ReactNode。

#### 11.2.3 命令与状态不需要改动

现有 `/chat-tools` 命令已支持：

```text
/chat-tools shell on|off
/chat-tools search on|off
/chat-tools mode off|shell|search|both
```

多选菜单的每一项切换只需提交对应的 `shell on|off` 或 `search on|off`；`chatMode` 投影的 `{ shell, webSearch }` 保持不变，Host 端 restriction / guard 也不需要改动。

#### 11.2.4 外观实现

客户端已注入一个 `<style>`；本轮在同一段样式中增加 `dsh-chat-` 前缀的类：

- `.dsh-chat-controls`：两个触发器的 flex 容器；
- `.dsh-chat-trigger`：胶囊式触发器，使用 `--dsw-alias-bg-layer-1` / `--dsw-alias-border-l1` / `--dsw-alias-label-secondary`；
- `:hover`：`--dsw-alias-bg-layer-2` / `--dsw-alias-border-l2` / `--dsw-alias-label-primary`；
- `:focus-visible`：`--dsw-alias-brand-primary` outline；
- `[data-active="true"]`：品牌色描边/浅色底，用于“有工具被启用”的状态；
- `:disabled`：降低透明度；
- `.dsh-chat-trigger-icon` / `-label` / `-chevron`：图标 14px、标签省略、chevron 12px；
- `[aria-expanded="true"] .dsh-chat-trigger-chevron`：旋转 180°；
- 继续保留 `body[data-dsh-chat-mode="1"] [data-slot="conversation.input.permission"] { display:none !important }`。

颜色使用主题 token，亮/暗主题自动适配；`color-mix` 与现有 `dsh-custom-css` 插件用法一致。可加 `@media (prefers-reduced-motion: reduce)` 关闭 transition。

### 11.3 核心进路

#### 11.3.1 客户端数据结构

```js
const TOOL_ITEMS = [
  { id: 'shell',  stateKey: 'shell',     icon: IconCodeOutlineRegular,  labelKey: 'tools.shell' },
  { id: 'search', stateKey: 'webSearch', icon: IconGlobeOutlineRegular, labelKey: 'tools.search' },
]
```

- `selectedIds = TOOL_ITEMS.filter(item => effectiveTools[item.stateKey]).map(item => item.id)`。
- `toolsItems = TOOL_ITEMS.map(item => ({ id: item.id, label: t(item.labelKey), icon: h(item.icon) }))`。
- 未来新增工具：在 `TOOL_ITEMS` 增加一项、在 `chatMode` 状态/投影增加一个字段、在 Host 端增加对应的 gated tool 与 command 分支即可；触发器和多选逻辑不需要重写。

#### 11.3.2 乐观更新

工具菜单保持打开时，需要即时反馈：

- 增加 `pendingTools` state；
- `effectiveTools = pendingTools ?? tools ?? { shell:false, webSearch:false }`；
- `onSelect(id)` 基于 `effectiveTools` 计算 next，`setPendingTools(next)`，提交 `/chat-tools <id> on|off`；
- `useEffect` 在 `tools` 投影与 `pendingTools` 一致时清除 pending；
- 命令失败时清除 pending。

这样连续勾选两项时，第二项基于第一项的 pending 状态计算，不会互相覆盖；菜单 check 标记与 trigger 标签即时更新。

#### 11.3.3 触发器

- 权限：图标按当前值选择 `PermissionIconReadOnlyRegular` / `PermissionIconWorkspaceWriteRegular`；标签 `权限：<值>`；`data-active` 不使用。
- 工具：图标固定 `IconSlidersTwoOutlineRegular`；标签按四项摘要 `工具：全部关闭 / 持久终端 / 联网搜索 / 持久终端 + 联网`；有任一工具启用时 `data-active="true"`。
- 两者都保留 `aria-expanded`、`aria-label`、`title`、`disabled`。
- chevron 用 `IconChevronDownOutlineRegular`；展开时旋转。

#### 11.3.4 权限菜单

权限菜单保持单选：

- `items` 增加权限图标；
- `selectedId` 仍为 `permissionValue`；
- `onSelect` 关闭菜单并提交 `/permission <id>`；
- 图标与 shipped 权限选择器保持一致。

### 11.4 问题与解决办法

| 问题 | 根因 | 修法 |
| --- | --- | --- |
| 多选菜单点一次就关闭 | 误以为 `Menu` 在 item click 时自行关闭 | 代码确认 `onSelect` 只回调父级；父级不把 `open` 设为 false，菜单保持打开。 |
| 连续勾选时第二项覆盖第一项 | 直接用 `tools` 投影（尚未更新）计算 next | 用 `effectiveTools = pendingTools ?? tools` 计算，并在投影追上后清除 pending。 |
| 图标不存在导致渲染报错 | 不同 DSH 版本的 primitives 导出可能变化 | 解构时做 `undefined` 检查，缺失时渲染无图标/文本 fallback；当前版本已确认导出存在。 |
| 主题/暗色不适配 | 硬编码颜色 | 只使用 `--dsw-alias-*` token；用 `color-mix` 生成半透明底色。 |
| 触发器与 shipped 权限控件风格冲突 | 原来的 inline style 是临时样式 | 改为 `dsh-chat-trigger` 类 + 主题 token；与 composer 其他控件保持一致的圆角/高度/字号。 |
| 菜单弹层样式无法自定义 | `Menu` 的 popup 由 primitives 拥有 | 只自定义触发器和 item icon/check；弹层行高、hover、焦点保留 shipped 行为。 |
| 未来工具扩展仍需改多处 | 当前 `chatMode` 状态是两个显式布尔 | 用 `TOOL_ITEMS` 数据驱动客户端；Host 端仍需增加状态字段、restriction/gate 与 command 分支，属于契约变化，需版本提升。 |

### 11.5 备选方案

| 方案 | 优点 | 缺点 | 结论 |
| --- | --- | --- | --- |
| `Menu` + `selectedIds`（本方案） | 复用 shipped 弹出层、键盘/焦点/portal；原生 check 多选；改动最小 | 弹层样式不能大改 | 采用 |
| 自建 popover + 两个 checkbox | 外观完全可控 | 需自己处理 portal、键盘、焦点、外部点击；与 shipped UI 不一致 | 不采用 |
| 两个独立 toggle chip | 无需菜单 | 不是“下拉框”，与用户要求不符；未来工具多时占空间 | 不采用 |
| 保留单选四模式 | 改动最小 | 用户明确要求多选；未来工具组合爆炸 | 不采用 |

### 11.6 版本与文档

- 这是**客户端 UI 行为/契约变化**：工具选择从单选四模式变为多选两项。`package.json` 版本从 `1.0.0` 提升到 `1.1.0`。
- README 的“工具”表、“默认状态”、“工具按需启用”、“版本契约”需要同步更新；README 首行的 Harness 版本声明保持 `0.2.2-rc.3`（Harness 版本未变）。
- FEASIBILITY 本节记录设计；实施记录追加到本节或新增小节。

### 11.7 验证与验收

- `scripts/client-test.mjs`：
  - 工具菜单 items 为 `['shell', 'search']`；
  - `selectedIds` 在关闭/仅终端/仅联网/两者时的数组；
  - 触发器包含图标、标签、chevron；
  - 调用 `toolsMenu.props.onSelect('shell')` 提交 `/chat-tools shell on`；
  - 权限菜单 items 仍为两项且带图标；
  - 非 chat 会话仍返回 `null`。
- `npm run build` / `npm run verify` 通过。
- 手动 GUI 验收：
  - 工具菜单打开后连续勾选两项，菜单不关闭，两项都出现 check；
  - trigger 标签依次为“全部关闭 / 持久终端 / 联网搜索 / 持久终端 + 联网”；
  - 权限菜单图标与当前值一致；
  - 亮/暗主题、hover、focus-visible、disabled 状态正常；
  - 页面刷新后控件与状态正常。
- 本轮只改 `client.js`、`scripts/client-test.mjs`、`README.md`、`package.json` 版本；Host 半与 preset 不变，不需要重启 DSH，页面刷新即可加载新的 Client 模块。

### 11.8 待确认的细节

- 图标选择：持久终端使用 `IconCodeOutlineRegular`，联网搜索使用 `IconGlobeOutlineRegular`，工具触发器使用 `IconSlidersTwoOutlineRegular`。如果你更希望联网搜索用 `IconSearchOutlineRegular`，或持久终端使用 `PluginArtworkTerminal`，可在实施轮次调整。
- 工具菜单是否需要额外的分组标题/说明文字？当前按“只有两个菜单项”的要求不加。


### 11.9 实施记录（2026-11-17）

**代码变化**：

- `client.js`
  - 工具菜单从四模式单选改为 `selectedIds` 多选，只保留 `shell`（持久终端）与 `search`（联网搜索）两项；
  - `TOOL_ITEMS` 数据表驱动菜单项、图标与状态字段；未来新增工具只需增加一项；
  - 工具 item 的 `onSelect` 不再关闭菜单，改为切换对应 `shell`/`webSearch` 并提交 `/chat-tools <id> on|off`；
  - 新增 `pendingTools` 乐观状态：勾选立即更新 check 与触发器标签，`chatMode` 投影追上后自动清除，命令失败时回滚；
  - 权限菜单保持 `selectedId` 单选，两个菜单的 item 增加图标；
  - 触发器改为 `dsh-chat-trigger` 类 + 主题 token 的胶囊样式，增加 `IconCodeOutlineRegular`（持久终端）、`IconGlobeOutlineRegular`（联网搜索）、`IconSlidersTwoOutlineRegular`（工具触发器）、权限图标、chevron 旋转、hover/focus-visible/active/disabled 状态；
  - 保留 `body[data-dsh-chat-mode="1"] [data-slot="conversation.input.permission"]` 隐藏规则。
- `scripts/client-test.mjs`
  - 增加 primitives 图标 stub；
  - 断言工具 items 为 `shell`/`search`，`selectedIds` 在关闭/仅终端/仅联网/两者时的数组；
  - 断言工具/权限 item 与触发器带图标；
  - 断言点击工具项提交 `/chat-tools shell on|off`、`/chat-tools search off`，且菜单不关闭；
  - 断言权限项提交 `/permission workspace-write`；
  - 保留非 chat 返回 `null` 的断言。
- `package.json`：版本 `1.0.0` → `1.1.0`。
- `README.md`：更新工具多选说明、默认状态、外观说明、故障排查、版本契约（`1.1.0`、工具菜单项）。

**未变化**：`preset.js`、`cordis.patch.yml`、`index.js`、`scripts/test.mjs`、Host 端权限锁与工具 gate。`chatMode` 投影仍是 `{ shell, webSearch }`；`/chat-tools` 命令语法完全兼容。

**验证**：

- `npm test`：preset 逻辑测试 + client smoke test 全部通过；
- `npm run build`：`verify · all checks passed`（含 Host 探针、目录/依赖/清单/构建系统检查）；
- 客户端多选行为已通过 stub 测试验证：`Menu` item 点击保持打开、`selectedIds` 正确、命令字符串正确；
- 由于只改 Client 半，不需要重启 DSH；页面刷新即可加载新的 `client.js`。
- 视觉验收待用户在 Desktop GUI 中刷新后新建/打开 Chat 会话确认：工具菜单两项带图标与 check、可连续勾选、触发器标签与 active 样式、权限菜单图标、亮/暗主题、hover/focus 状态。

**注意**：

- Desktop profile 里安装的 bundle 版本元数据可能仍显示 `1.0.0`（link 包的 `package.json` 已改为 `1.1.0`；plugin manager 的已安装记录可能需要移除后重新安装才会刷新）。Client 模块本身从 link 路径读取，刷新页面即可拿到 `1.1.0` 的 `client.js`。
- 若用户在 GUI 中看到旧的四模式菜单，说明浏览器仍缓存旧客户端模块；刷新页面或重新打开 GUI 即可。

---

## 十二、预设描述中文化（2026-11-17）

### 12.1 目的与范围

用户澄清：“预设显示名：英文 Chat”只针对 **名称**；预设的 **描述文本** 应为中文。把 `preset-chat` 的 `description` 从英文改为中文，名称仍为 `Chat`。

### 12.2 变更

`cordis.patch.yml`：

```yaml
config:
  id: chat
  name: Chat
  description: 以纯对话为主；只在用户明确要求时读取文件，持久终端与联网搜索按需启用。
```

英文描述原文为 `Conversation-first; reads files only when asked, with shell and web search opt-in.`，语义保持不变。

### 12.3 影响与版本

- 仅显示文本变化，不影响 preset 组合、工具、权限锁或命令；`package.json` 保持 `1.1.0`。
- README 未引用该描述原文，无需改动；版本契约中的 preset 显示名仍为 `Chat`。
- `npm run build` 通过（`verify · all checks passed`）。

### 12.4 生效方式

预设声明来自 bundle patch，运行中的 Host 在启动时装载该声明；修改 `cordis.patch.yml` 后，**运行中的 Desktop Host 需要重启 DSH** 才会显示新的中文描述（或由插件管理器重新装载该 bundle）。这不是 Client 半的文件改动，刷新页面不会更新 Host 已装载的 preset 描述。

按工作区规则第 8 条：需要重启才能生效时，停止后续工作并提示用户重启。本轮不尝试 workaround。

---

## 十三、新 Chat 会话权限与首轮工具可见性修复（2026-11-17）

### 13.1 现象

用户重启 DSH 后新建 Chat 会话，观察到：

1. 权限总是显示 **工作区内修改**，而不是设计的 `read-only`。
2. 首轮对话的“可用工具”统计包含 `持久终端` / `联网搜索`，即使两项都未勾选；直到第二轮才显示工具已被移除。
3. 尚未测试再次手动启用工具的结果。

### 13.2 调查与证据

#### 13.2.1 权限投影的默认值

`@deepseek-ai/dsh-permission-presets` 的 `permissions` 投影：

- `init: () => ({ ...EMPTY_KNOBS, seeded: false })`；
- `derive(state)` 在没有任何 `permission/preset` / `sandbox/mode` / `approval/policy` 事件时，使用组合默认值：`ctx.shell.sandboxMode`（base 默认 `workspace-write`）与 `ctx.approval.config.policy`（`ask`）；
- 因此一个**尚未创建 Agent / 尚未 pin 的空白 Chat 会话**，权限投影显示 `workspace-write`；
- 真正的 pin 只发生在 `agent/created` 的 `pinInitialPermission`（全局服务，`prepend: true`）与我们的 preset 插件 `pinPermission`（普通 listener）。

这解释了“打开新 Chat 对话后权限总是工作区内修改”的**空白会话阶段**：我们的 `read-only` pin 还没运行；客户端先读到了组合默认值。

#### 13.2.2 首轮工具 set 的解析顺序

`@deepseek-ai/dsh-agent-loop/src/agent.ts` 的 `preStep` 顺序是：

```text
line 298: const toolSet = await this.loopCtx.tools.resolve({ agent: this, modelSelection, signal })
line 300: const assembly = await this.loopCtx.systemPrompt.assemble({ ... toolSet })
line 303: await this.ctx.waterfall('agent/pre-step', ...)
```

也就是说 **工具集在 `agent/pre-step` 之前就已经 resolve**。我们在 `agent/pre-step` 里做的 lazy init / reapply 无法影响当前 step 的 toolSet；它只能影响后续 step。

`@deepseek-ai/dsh-agent-loop/src/index.ts` 的 `initializeAgent`：

- line 574 构造 `ReactLoopAgent`（机器已可处理 inbox）；
- line 629 `agent.ctx.sessions.enter/announce`；
- line 638 才 `agents.announce(agent, source)`，即触发 `agent/created`。

因此，如果首个 prompt 在 `agent/created` 的 listener 之前/期间被处理，首轮 `tools.resolve` 会看到 preset 中已注册的 `bash` / `web_search`；我们的 `restrict()` 在 `agent/created`（或 `agent/pre-step`）才生效，于是**首轮包含、第二轮移除**。

#### 13.2.3 `known` 缓存

当前 `preset.js` 的 `applyRestrictions` 在首次调用时计算 `entry.known`（通过 `agent.ctx.tools.get(tool, agent)`）。如果首次调用时工具尚未注册，`known` 会缓存为空数组，之后不再重试；这会造成“第一次不限制、后续才限制”的另一条路径。

#### 13.2.4 现有验证的盲区

此前的 temp profile 集成探针只做了：

```text
createSession -> 立即读取 permission / tools.schemas
```

没有发送首个 prompt，因此无法暴露“工具在 `agent/created` 之前就 resolve”的时序问题；探针看到的 read-only 与 restricted tools 是创建完成后的状态，不等于**首轮请求**使用的状态。

### 13.3 根因结论

1. **权限**：空白 Chat 会话的 `permissions` 投影在 Agent/pin 之前使用组合默认 `workspace-write`；我们的 `read-only` pin 只在 `agent/created`，对“新会话界面/首轮”过晚。
2. **工具**：首轮 `tools.resolve` 发生在 `agent/pre-step` 之前；`agent/created` 的普通 listener 可能晚于首个 prompt 的 resolve，导致首轮工具集包含 `bash`/`web_search`。`known` 空缓存会放大该问题。
3. **现有实现没有在“preset 选择/会话创建”阶段做任何 Chat 专属的权限 pin**，因此空白会话一定先显示组合默认。

### 13.4 修法（下一轮实施）

#### 13.4.1 Host 半：在会话创建/预设选择时 pin

`index.js`（Host 半）增加：

```js
export const inject = ['permissionPresets']

export function apply(ctx) {
  // session/created dispatch keeps the Session read-only; an append made by
  // a creation listener throws. Defer one microtask.
  ctx.on('session/created', (session) => {
    queueMicrotask(() => pin(ctx, session))
  })
  // Preset switched to chat while blank: appending inside an append
  // notification reenters, so defer too.
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'agent-preset/selected') return
    if (event.data.agentPreset !== 'chat') return
    queueMicrotask(() => pin(ctx, session, true))
  })
}

function pin(ctx, session, bySelection = false) {
  if (!bySelection && session.header.agentPreset !== 'chat') return
  if (session.header.isSeeded === true) return
  try {
    if (ctx.permissionPresets.current(session) !== 'read-only') {
      ctx.permissionPresets.set(session, 'read-only')
    }
  } catch {
    // The permission projection may not be ready; agent/created still retries.
  }
}
```

注意：

- `session/created` 的 listener 是 `(session)`；`session/event` 是 `(session, event)`（与 `dsh-agent-preset-registry/src/index.ts` 的用法一致）。
- **关键约束**：`dsh-session` 的 `announce()` 文档明确“The Session remains read-only throughout synchronous dispatch; successful completion enables appends”；`publicationEntry()` 也会在 `announcement !== 'complete'` 时拒绝 append。因此 `session/created` listener 必须 `queueMicrotask`，不能在同步 dispatch 中 `permissionPresets.set`。
- `session/event` 的通知发生在 `commit()` 的 append 发布期间；同步 append 会触发 `session append cannot reenter while another append is being published`，因此也必须 defer。
- `isSeeded` 用来避免把已恢复的 workspace-write Chat 会话重置为 read-only。
- `session/created` 可能对恢复的会话也触发；`isSeeded` 与 `agent/created` 的 `source` 双重判断。
- 该 pin 在 `permissionPresets` 的 `permissions` 投影已注册后生效；Host 激活顺序保证这一点。

#### 13.4.2 preset 半：更早的 restriction

`preset.js`：

1. `ctx.on('agent/created', handler, { prepend: true })`，让 restriction/permission pin 排在普通 creation observer 之前。
2. `applyRestrictions` 不缓存空 `known`：
   ```js
   if (entry.known === undefined || entry.known.length === 0) { ... recompute ... }
   ```
3. entry 保存 `agent` 引用，并注册 `ctx.on('tools/change', ...)`：当工具注册/限制变化时，对每个已知 Chat Agent 重新 `applyRestrictions`；用 `key` 去重避免递归。
4. `agent/pre-step` 保留 lazy init/reapply，作为后续 step 的兜底；但明确它**不能**修复当前 step 的 toolSet（因为 resolve 在前）。

#### 13.4.3 若首轮仍包含工具：动态挂载（备选）

如果上述 prepend + tools/change 仍不能保证首轮（即首轮 toolSet 确实在 `agent/created` 之前 resolve），则采用更彻底的方案：

- 从 preset 组合中**移除** `persistent-bash`/`persistent-pwsh` 与 `web_search` 的默认挂载；
- 保留终端后端与 `web_fetch`；
- 在 Chat preset 插件中按 Agent 的 `chatMode` 状态**动态挂载** gated 工具：`agent.ctx.plugin(...)`（bash/pwsh、web_search 的独立实例）；
- 默认关闭时首轮完全没有这些工具；用户勾选后挂载，下一次 step 生效；
- 代价：preset 插件需要 import `@deepseek-ai/dsh-tool-bash-persistent` / `@deepseek-ai/dsh-tool-pwsh-persistent` / `@deepseek-ai/dsh-tool-web`，引入运行时依赖与构建 pin；需评估子插件生命周期、dispose、resume 顺序。
- 这是“保证首轮不可见”的唯一彻底方案；优先尝试 13.4.1/13.4.2 的低风险修复。

#### 13.4.4 权限的另一种备选

把 Chat 的 `persona`/预设默认权限改为 `read-only`（全局 `permission-presets` 的 `defaultPreset` 不能按 preset 设置）；不可取，会影响其他模式。Host `session/created` pin 是范围最小的方案。

### 13.5 验证计划

- **逻辑测试**：扩展 `scripts/test.mjs` / `client-test.mjs`，覆盖 `session/created` pin、`agent/created` prepend、`tools/change` reapply、空 `known` 重试。
- **Host 集成**：temp profile 探针增加“创建 Chat 会话后、发送首个 prompt 前”的 permission/tools 检查；如可行，用 fake LLM adapter 发送首个 prompt 并检查首轮 `request/header` 的工具列表。
- **GUI 验收**：
  - 新建 Chat 会话，**未发送消息前**权限应为 `仅可查看`；
  - 首轮工具列表不包含 `持久终端` / `联网搜索`；
  - 第二轮仍不包含；
  - 勾选 `持久终端` 后，下一轮出现 `bash`；取消后下一轮消失；
  - 恢复一个已保存 `workspace-write` 的 Chat 会话，首轮不被重置为 read-only；
  - `web_fetch` 始终可用。
- **构建**：`npm run build` / `npm run verify`。
- **版本**：bug fix，`1.1.0` → `1.1.1`；README 更新“默认权限/首轮工具”说明与故障排查。
- **生效**：Host 半与 preset 插件变化需要重启 DSH；客户端半若有变化需刷新页面。实施后按规则 8 提示重启，不尝试 workaround。

### 13.6 需要用户确认/协助

- 若方便，请提供出问题的 Chat 会话 ID（或会话头/首轮 `request/header` 的工具列表），以便确认首轮实际请求是否包含 `bash`/`web_search`，而不只是统计面板的显示。
- 若无法提供，按 13.4.1/13.4.2 先修复并验收；若首轮仍出现，再采用 13.4.3 的动态挂载方案。

### 13.7 实施记录（2026-11-17）

**代码变化**：

- `index.js`（Host 半）不再为空：
  - `inject = ['permissionPresets']`；
  - `session/created`：对 `header.agentPreset === 'chat'` 且 `isSeeded !== true` 的会话，在**下一个 microtask** 中 `permissionPresets.set(session, 'read-only')`；
  - `session/event`：对 `agent-preset/selected` 且 `agentPreset === 'chat'` 的空白会话，同样在 microtask 中 pin；
  - **defer 的原因**：`dsh-session` 的 `announce()` 在同步 `session/created` dispatch 期间保持 Session read-only，`publicationEntry()` 会拒绝 append；`session/event` 的通知在 append 发布期间，同步 append 会触发 reentry 错误。microtask 在 dispatch 完成之后、首个 prompt 之前运行；
  - `pin()` 先读 `current`，已是 `read-only` 则 no-op；异常只记录 warning，交给 preset 半的 `agent/created` 重试。
- `preset.js`：
  - `ctx.on('agent/created', ..., { prepend: true })`；
  - `applyRestrictions` 的 entry 保存 `agent` 引用；`known` 为空时每次重新计算，不再永久缓存空数组；
  - 新增 `ctx.on('tools/change', ...)`：遍历已知 Chat Agent 重新 `applyRestrictions`，用 `key` 去重终止自身 restrict 触发的递归；
  - `agent/pre-step` 在已初始化时也 reapply restriction，作为后续 step 的兜底；注释明确它不能改变当前 step 已 resolve 的 toolSet。
- `scripts/host-contract.mjs`：增加 Host 半 `permissionPresets` inject、`session/created`/`session/event` listener、fresh/seeded/switch 三种 pin 分支的断言。
- `scripts/test.mjs`：增加 `agent/created` prepend 断言；增加“初始工具为空 → 稍后注册 → `tools/change` 重新限制”的断言。
- `package.json`：`1.1.0` → `1.1.1`。
- `README.md`：更新默认权限（创建时 pin）、权限锁定、工具按需启用（prepend/tools-change/pre-step 限制说明）、故障排查、版本契约 `1.1.1`。

**验证**：

- `npm test`：preset 逻辑测试（含 prepend、tools/change、空 known 重试）+ client smoke test 全部通过；
- `npm run build`：`verify · all checks passed`，包括 Host 探针的 fresh/seeded/switch pin 分支；
- 未在本次运行中直接复现 GUI 的首个 prompt；低风险修复已就位，需重启后在 GUI 复测首轮工具列表与权限。
- 如果首轮仍包含 gated 工具，说明首轮 `tools.resolve` 确实早于 `agent/created`；下一步按 13.4.3 动态挂载工具（需要引入工具包依赖与生命周期管理）。

**生效**：

- `index.js`/`preset.js` 是 Host/预设半变化，必须重启 DSH；刷新页面只更新 Client 半。
- 按工作区规则第 8 条，实施并验证后提示用户重启，不尝试 workaround。
