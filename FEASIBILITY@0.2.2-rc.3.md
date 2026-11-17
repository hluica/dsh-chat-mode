# 对话模式（Agent preset `chat`）可行性、进路与实施计划

- **Harness 版本**：`0.2.2-rc.3`（`DSH_INSTALL_DIR/package.json` 为 `@deepseek-ai/dsh@0.2.2-rc.3`）
- **工作区**：`/Users/hanluica/Documents/deepseek-harness/local-plugins/dsh-chat-mode`
- **状态**：已实施并完成 Host 端集成验证（插件 `1.0.0`，2026-11-17）；客户端视觉验收待用户新建 Chat 会话确认
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
