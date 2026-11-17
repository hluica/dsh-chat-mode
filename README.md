# @local/dsh-chat-mode

最后实质性修改于Harness版本：0.2.2-rc.3

在 DSH 中新增一个以纯对话为主的 Agent 预设 **Chat**（preset id：`chat`）：默认只进行文字对话，文件读取需要用户明确要求；持久终端与联网搜索默认隐藏，由用户在输入框左侧的“对话设置”中显式启用；权限只允许“仅可查看”和“工作区内修改”，不允许选择“完全权限”。

## 使用与效果

### 选择对话模式

新建会话时，在预设选择器中选择 **Chat**（排在 `order: 5`）。该预设的默认行为：

- 不主动读写工作区文件，也不主动执行命令。
- 普通问答、解释、分析、写作、翻译、头脑风暴直接回答，不为了“确认一下”而读取文件或搜索网络。
- 用户手动附加到对话中的文件，或消息中明确指向的文件，可以直接读取。
- 不提供 `write`、`edit`、`apply_patch`；需要修改文件时建议切换到支持修改的模式。
- `web_fetch` 可以直接读取用户给出的链接；`web_search` 默认关闭。

### 输入框左侧的“对话设置”

Chat 会话的输入框左侧会出现两个紧凑下拉框：

| 控件 | 可选值 | 效果 |
| --- | --- | --- |
| 权限 | 仅可查看 / 工作区内修改 | 提交 `/permission read-only` 或 `/permission workspace-write`；不提供完全权限。 |
| 工具 | 持久终端 / 联网搜索（可多选） | 勾选任意一项即提交 `/chat-tools shell on` 或 `/chat-tools search on`；再点一次取消。两项都不勾选即全部关闭。 |

工具下拉框是**多选菜单**：菜单保持打开，可以连续勾选两项；每项带图标与 check 标记，触发器显示当前组合（关闭 / 持久终端 / 联网搜索 / 持久终端 + 联网）。未来增加工具时，客户端只需在 `TOOL_ITEMS` 表中增加一个菜单项。

默认状态：

- 权限：新 Chat 会话在**创建时**即 pin 为 **仅可查看**（早于首轮请求，空白新会话界面也显示正确值）；恢复的 Chat 会话保留已保存的 `read-only` / `workspace-write`，若发现更宽权限则纠正为 `read-only`。
- 工具：两项都**不勾选**，即 `bash`/`pwsh` 与 `web_search` 不出现在模型工具列表中。
- `read`、`read_image`、`glob`、`grep`、`web_fetch`、`ask_user_question` 始终可用，但由 system prompt 约束为“只在用户明确要求时使用”。

两个下拉框的外观使用宿主主题 token：带权限/终端/联网图标、胶囊式触发器、hover / focus-visible / active / disabled 状态，以及展开时旋转的 chevron；亮/暗主题自动适配。工具菜单与权限菜单都复用 shipped `Menu` 的 portal、键盘与焦点行为。

### 权限与一次性授权

- 允许的权限预设只有 `read-only` 与 `workspace-write`，两者的 approval policy 都是 `ask`。
- 因此模型仍可以在工具调用中通过 `sandbox_permissions` + `justification` 申请一次性的更宽权限；用户批准后只对那一次调用生效。
- `danger-full-access` 被 Agent 作用域的 `/permission` 命令拒绝；`/permission danger-full-access` 会返回错误，不改变会话权限。
- Chat 会话中，客户端的 shipped 权限控件会被隐藏，改用本插件的两选项下拉框。斜杠命令 `/permission` 仍可用，但其 picker 仍会显示完整进程目录；选择完全权限会被 Host 拒绝。**推荐使用输入框左侧的下拉框**。

## 工作原理

### 预设组合

`cordis.patch.yml` 插入一个空的 Host 行和一个 `@deepseek-ai/dsh-agent-preset` 声明：

```text
preset-chat (id: chat, name: Chat, order: 5)
  persona（complete: true, includeRuntimeContext: true）
  time-context
  tool-fs（read/readImage 开启，write/edit/applyPatch 关闭）
  tool-fs-search
  tool-ask-user
  tool-web（search + fetch 都注册，web_search 默认被 restrict 隐藏）
  compaction（basic + command-compact + tool-result-pruner）
  persistent-shell（terminal + bash/pwsh persistent，默认被 restrict 隐藏）
  chat-mode preset 插件
```

`persona.complete: true` 让 Chat 使用自己的 system prompt，但 `includeRuntimeContext: true` 保留文件策略、cwd、时间等运行时上下文。

### 权限锁定

- Host 半在 `session/created` 后的下一个 microtask 中，对 `header.agentPreset === 'chat'` 且未 seeded 的新会话 pin `read-only`（`session/created` 同步 dispatch 期间 Session 只读，不能直接 append）；这发生在 Agent/首轮请求之前，因此空白新会话界面和首轮请求都看到正确的权限。空白会话被切换到 Chat 时，`agent-preset/selected` 也会触发同样的 pin。
- preset 插件在 `agent/created`（`prepend: true`）时读取 `ctx.permissionPresets.current(session)`：
  - `source === 'startup'`（新会话）→ 固定为 `read-only`；
  - `resume` / `clear` / `compact` → 只保留 `read-only` / `workspace-write`；
  - 如果全局默认被设为完全权限，新 Chat 会话仍会被纠正为 `read-only`。
- 在 Agent 作用域注册同名 `/permission` 命令，shadow 全局命令，只接受两个允许值；该命令随 Agent 一起释放。
- 客户端只在 Chat 会话中显示权限下拉框；shipped 权限 seat 通过 `body[data-dsh-chat-mode="1"] [data-slot="conversation.input.permission"]` 隐藏。

### 工具按需启用

- 预设在 preset 作用域注册 `bash`/`pwsh` 与 `web_search`。
- preset 插件在每个 Chat Agent 的 `agent.ctx.tools` 上注册 `restrict({ deny })`：
  - `shell: false` → 隐藏 `bash`（Windows 为 `pwsh`）；
  - `webSearch: false` → 隐藏 `web_search`；
  - 用户启用后 dispose 对应 restriction，下一次 step 的工具 schema 出现。
- `agent/created` listener 使用 `prepend: true`，尽量早于普通 creation observer；`known` 为空时不缓存，并在 `tools/change` 时对已知 Chat Agent 重新应用 restriction，避免“首轮包含、第二轮才移除”。
- `tools/pre-execute` 兜底：如果某个 batch 在 restriction 变化前已解析，调用被关闭的工具会得到明确的 deny 文本，提示用户在“对话设置”中启用。
- 状态由 log-only 的 `chat-mode/tools` 事件与 `chatMode` 会话投影持久化，resume/fork 后恢复。
- open turn 期间切换工具不会直接 append；选择先进入内存 pending，在下一个 accepted `agent/pre-step` 写入，restriction 立即按 pending 生效。
- 注意：agent loop 在 `agent/pre-step` **之前**就 resolve 工具集，因此 pre-step reapply 只影响后续 step；首轮的正确性依靠 Host 提前 pin、`agent/created` prepend 与 `tools/change` 重试。

### 客户端控件

- 在 `conversation.input.left` 注册 `chat-mode-controls`，只在 `agentPreset === 'chat'` 时渲染。
- 使用 shipped `Menu` 组件与主题 token，弹出层 portal 到 body，避免 composer 裁剪。
- 工具菜单使用 `Menu` 的 `selectedIds` + `selection: 'check'` 多选模式；item 点击只回调 `onSelect`，父组件保持 `open`，因此可以连续勾选。`TOOL_ITEMS` 是数据表，未来工具只需增加一项。
- 工具状态使用乐观 `pendingTools`：勾选立即更新 check 标记与触发器标签，等 `chatMode` 投影追上后清除；命令失败时回滚。
- 权限菜单使用 `selectedId` 单选；两个菜单的 item 都带图标，触发器使用主题 token 的胶囊样式。
- 权限与工具下拉框都通过 `session.command()` 提交，执行路径与 shipped 控件一致。
- 中英文文案由 Client locale 的 `chatMode` 命名空间提供。

## 依赖与构建

本插件是**零运行时依赖**的 bundle：

- Host 半 `index.js` 不 import 任何包。
- `preset.js` 只使用 Cordis context 提供的服务，不 import `zod` 或 `defineTool`。
- `client.js` 只 require baseline 的 `react` 与 `@deepseek-ai/dsh-client-ui-primitives`。
- 因此 `package.json` 不声明 `dependencies`，构建系统走“不建树”分支。

构建系统与其他本地插件共用参考副本。开发时：

```sh
cd /Users/hanluica/Documents/deepseek-harness/local-plugins
node build-system/sync.mjs dsh-chat-mode   # 同步 scripts/（仅首次或构建系统更新时）
cd dsh-chat-mode
npm run build                              # 构建 + verify
npm run verify                             # 单独验证
npm test                                   # preset 与 client 逻辑测试
```

`npm run build` 会清理 macOS sidecar（`.DS_Store`）并检查：

- 目录内没有符号链接 / Finder 替身 / macOS 边角文件；
- `package.json` 的 `exports`、`dsh.bundle.patch`、`dsh.client`、locale 锚点、icon、`files[]`；
- `index.js` / `client.js` 可解析；
- `scripts/host-contract.mjs` 的 Host 探针通过；
- `npm test` 通过。

安装到 profile：

```text
plugin_manager install_bundle
  target: /Users/hanluica/Documents/deepseek-harness/local-plugins/dsh-chat-mode
```

安装后 `preset-chat` 应处于 active；新建会话才使用新预设。客户端半可能需要刷新页面；如果插件管理器提示需要重启，按提示重启 DSH。

## 适用范围与边界

- **不提供文件修改工具**：没有 `write`、`edit`、`apply_patch`。如需修改文件，请切换到 `standard` / `ptc` 等模式。
- **不提供 Office、技能、Goal、Plan、Todo、Subagent、Workflow、日程、后台 jobs** 等工具；这是“纯对话”的刻意裁剪。
- **shipped `/permission` slash picker 仍显示完全权限**：本插件通过 Agent 作用域命令拒绝它，但无法修改 shipped picker 的进程目录。输入框左侧的权限下拉框才是推荐入口。
- **CSS 隐藏 shipped 权限控件**：依赖 renderer 的 `data-slot` 锚点；如果未来版本重命名该锚点，控件会重新出现，但 Host 端仍然拒绝完全权限。
- **preset 不是安全沙箱**：DSH 文档明确 presets 可以执行 Host 代码。这里的权限锁是功能/策略层，不是安全边界；真正的文件限制来自 sandbox policy 与 approval。
- **首版只覆盖新建 Chat 会话**：不支持在已有会话中切换 preset 后即时重建权限命令/restriction；需要新建会话。
- **Host 级工具仍存在**：例如 `team_task_*`、`working_directory` 由 Host 组合提供，所有预设都会继承；它们不做文件内容读写。若需要进一步收紧，可在 Agent 作用域用 `restrict()` 追加。
- **`complete: true` 会抑制工具插件贡献的 prompt guidance**：工具 schema 与 deny 提示仍然存在；如果实测发现读取/搜索质量不足，可在 persona 中补充规则，或改用 `complete: false` + 更克制的 prefix。

## 故障排查

**预设列表里没有 Chat**

- `plugin_manager list_bundles` 确认 `@local/dsh-chat-mode` 已安装。
- `plugin_manager list_plugins` 搜索 `preset-chat`，确认 `enabled: true`、`fiberPhase: active`。
- 检查 `cordis.patch.yml` 的 `id: preset-chat` 与 `config.id: chat`；改完重新安装/重载。
- 新建会话才使用新预设；已有会话保留其原组合。

**输入框左侧没有“对话设置”**

- 确认当前会话的 preset 是 `chat`（会话头的预设标签）。
- 刷新页面；客户端半是浏览器模块，安装后需要重新加载。
- 浏览器控制台若提示 `@local/dsh-chat-mode` 模块加载失败，检查 `client.js` 是否可解析、`dsh.client.inject` 是否列出了 `@deepseek-ai/dsh-client-ui-primitives` 等包。
- 非 Chat 会话不显示该控件；这是设计行为。

**工具菜单勾选“持久终端”后模型仍没有 bash**

- 确认当前会话是 Chat，且 `chatMode` 投影已更新（切换后通常下一次 step 生效）。
- 若在模型运行中切换，选择会在下一个 accepted pre-step 写入；工具 schema 可能要到下一轮才出现。
- 检查 `agent.ctx.tools.schemas(agent)` 是否包含 `bash`；若包含但模型不调用，检查 system prompt 是否要求用户明确指示。

**首轮工具列表仍包含持久终端 / 联网搜索**

- 确认已重启 DSH；Host 半与 preset 插件的变化不会只靠刷新页面生效。
- 检查 `agent/created` listener 是否为 `prepend: true`、`tools/change` 是否在工具注册后重新应用 restriction；若首轮仍出现，说明首轮 `tools.resolve` 确实发生在 restriction 之前，需要采用 FEASIBILITY 13.4.3 的动态挂载方案。

**权限下拉框选“工作区内修改”后仍无法写文件**

- Chat 模式没有 `write`/`edit`/`apply_patch`；只能通过勾选“持久终端”后用 shell 在工作区内写。
- `read-only` 下 shell 写操作会被 sandbox 拒绝，并给出 escalation 提示；切到 `workspace-write` 或批准一次性权限后才可写。
- 确认批准策略为 `ask`（`read-only` / `workspace-write` 的 shipped 配置都是 `ask`）。

**`/permission danger-full-access` 仍然出现在 slash picker**

- 这是 shipped picker 的进程目录行为；Host 端 Agent 作用域命令会拒绝该值。使用输入框左侧的权限下拉框，或忽略该行。

**`npm run verify` 报 `no macOS sidecar files` / `no symbolic links`**

- 工作区里的 `.agents/sample/chat-demo` 是官方 Chat 参考源码，自带 `node_modules` 与 `.DS_Store`。构建系统要求插件根目录内全是真实文件；将 `node_modules` 移出插件目录（或删除后重新 `pnpm install`），并清理 `.DS_Store` 后重试。
- 本插件开发时已将参考项目的 `node_modules` 移到 `/tmp/dsh-chat-mode-chat-demo-node_modules`，源码仍在 `.agents/sample/chat-demo`。

**安装/重载后需要重启**

- 如果插件管理器提示 `restart-required`，说明变更触及了运行中的 Host 插件；按提示重启 DSH，不要尝试绕过。

## 版本契约

| 项目 | 值 |
| --- | --- |
| 插件版本 | `1.1.1` |
| 包名 | `@local/dsh-chat-mode` |
| Loader entry id | `dsh-chat-mode` |
| preset id | `chat` |
| preset 显示名 | `Chat` |
| preset order | `5` |
| 会话投影 key | `chatMode`（`{ shell: boolean, webSearch: boolean }`） |
| 会话事件 | `chat-mode/tools` |
| 权限命令 | `/permission read-only\|workspace-write`（Agent 作用域 shadow） |
| 工具命令 | `/chat-tools [mode off\|shell\|search\|both] [shell on\|off] [search on\|off]` |
| 工具菜单项 | `shell`（持久终端）、`search`（联网搜索），多选 |
| 客户端 slot | `conversation.input.left` / id `chat-mode-controls` |
| locale 命名空间 | `chatMode` |

行为、接口或契约变化时提升 `package.json` 版本；纯文档改动保持版本。迁移记录与历史对比写入 `FEASIBILITY@<harness-version>.md`。

## 命名约定

- 目录/包：`dsh-chat-mode` / `@local/dsh-chat-mode`
- Loader 行 id：`dsh-chat-mode`；preset 行 id：`preset-chat`
- preset id：`chat`（小写、稳定，被会话日志记录）
- 新插件沿用 `dsh-` 前缀与独立 Git 仓库约定；远程操作需用户明确批准。
