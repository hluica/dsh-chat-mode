# @local/dsh-chat-mode

最后实质性修改于Harness版本：0.2.2-rc.3

在 DSH 中新增一个以纯对话为主的 Agent 预设 **Chat**（preset id：`chat`）：默认只进行文字对话，文件读取需要用户明确要求；持久终端、联网搜索与 Wolfram MCP 工具默认隐藏，由用户在输入框左侧的“对话设置”中显式启用；权限只允许“仅可查看”和“工作区内修改”，不允许选择“完全权限”。

Wolfram 工具是**动态工具包**：只有当 DSH 中存在 `mcp__WolframLanguage__*` 工具时，工具菜单才出现“Wolfram”一项；MCP 注册/移除时，菜单、模型工具列表与 system prompt 会一起自动更新，无需刷新页面或重启会话。

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

| 控件 | 可选值                                             | 效果                                                                                                         |
| ---- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 权限 | 仅可查看 / 工作区内修改                            | 提交 `/permission read-only` 或 `/permission workspace-write`；不提供完全权限。                              |
| 工具 | 持久终端 / 联网搜索 / Wolfram（可多选，按可用性） | 勾选任意一项即提交 `/chat-tools shell on`、`search on` 或 `wolfram on`；再点一次取消。全部不勾选即全部关闭。 |

工具下拉框是**多选菜单**：菜单保持打开，可以连续勾选多项；每项带图标与 check 标记，触发器显示当前组合（关闭 / 持久终端 / 联网搜索 / Wolfram，多个启用时用 ` + ` 连接）。Wolfram 项只在 `chatMode.availability.wolfram` 为 true（即当前注册表存在 `mcp__WolframLanguage__*` 工具）时渲染；其余两项始终显示。未来增加工具时，客户端只需在 `TOOL_ITEMS` 表中增加一个菜单项，Host 端在 `TOOL_PACKS` 表中增加对应条目。

默认状态：

- 权限：新 Chat 会话在**创建时**即 pin 为 **仅可查看**（早于首轮请求，空白新会话界面也显示正确值）；恢复的 Chat 会话保留已保存的 `read-only` / `workspace-write`，若发现更宽权限则纠正为 `read-only`。
- 工具：Wolfram 存在时三项都**不勾选**，即 `bash`/`pwsh`、`web_search` 与 `mcp__WolframLanguage__*` 都不出现在模型工具列表中；Wolfram 不存在时菜单只有前两项。
- `read`、`read_image`、`glob`、`grep`、`web_fetch`、`ask_user_question` 始终可用，但由 system prompt 约束为“只在用户明确要求时使用”。

两个下拉框的外观使用宿主主题 token：带权限/终端/联网/Wolfram 图标、胶囊式触发器、hover / focus-visible / active / disabled 状态，以及展开时旋转的 chevron；亮/暗主题自动适配。工具菜单与权限菜单都复用 shipped `Menu` 的 portal、键盘与焦点行为。

### 权限与一次性授权

- 允许的权限预设只有 `read-only` 与 `workspace-write`，两者的 approval policy 都是 `ask`。
- 因此模型仍可以在工具调用中通过 `sandbox_permissions` + `justification` 申请一次性的更宽权限；用户批准后只对那一次调用生效。
- `danger-full-access` 被 preset 作用域的 `/permission` 命令拒绝；`/permission danger-full-access` 会返回错误，不改变会话权限。
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

Wolfram 工具**不在 preset 内注册**：它们由 `@local/dsh-wolfram-mcp` 通过 `mcpManager` 注册为全局 MCP 工具。preset 只按 `mcp__WolframLanguage__` 前缀动态发现、整包 gate，并在 system prompt 中按需注入 guidance。

`persona.complete: true` 让 Chat 使用自己的 system prompt，但 `includeRuntimeContext: true` 保留文件策略、cwd、时间等运行时上下文；persona prefix 内的 `{{chat_tool_guidance}}` 由 preset 插件的 prompt 变量按 step 求值，不依赖额外 section。

### 权限锁定

- Host 半在 `session/created` 后的下一个 microtask 中，对 `header.agentPreset === 'chat'` 且未 seeded 的新会话 pin `read-only`（`session/created` 同步 dispatch 期间 Session 只读，不能直接 append）；这发生在 Agent/首轮请求之前，因此空白新会话界面和首轮请求都看到正确的权限。空白会话被切换到 Chat 时，`agent-preset/selected` 也会触发同样的 pin。
- preset 插件在 `agent/created`（`prepend: true`）时读取 `ctx.permissionPresets.current(session)`：
  - `source === 'startup'`（新会话）→ 固定为 `read-only`；
  - `resume` / `clear` / `compact` → 只保留 `read-only` / `workspace-write`；
  - 如果全局默认被设为完全权限，新 Chat 会话仍会被纠正为 `read-only`。
- 在 preset 作用域注册同名 `/permission` 命令，shadow 全局命令，只接受两个允许值；该命令随 preset 生命周期释放/重注册，不会在 chat→other→chat 切换时累积 Agent 作用域注册。
- 客户端只在 Chat 会话中显示权限下拉框；shipped 权限 seat 通过 `body[data-dsh-chat-mode="1"] [data-slot="conversation.input.permission"]` 隐藏。

### 工具按需启用

- `preset.js` 用一张 `TOOL_PACKS` 表描述三个工具包（shell、联网搜索、Wolfram）：
  - 静态包用 `names` 列出预设内注册的工具（`bash`/`pwsh`、`web_search`）；
  - 动态包用 `prefix` 从全局工具注册表发现工具（Wolfram 为 `mcp__WolframLanguage__`）；
  - 每个包带状态字段、deny 文案与可选 guidance。
- preset 插件在每个 Chat Agent 的 `agent.ctx.tools` 上注册 `restrict({ deny })`：未启用的包整包隐藏，用户启用后 dispose 对应 restriction，下一次 step 的工具 schema 出现。
- `agent/created` listener 使用 `prepend: true`，尽量早于普通 creation observer；静态包的 `known` 为空时不缓存，并在 `tools/change` 时对已知 Chat Agent 重新应用 restriction，避免“首轮包含、第二轮才移除”。
- **动态工具包**：`tools/change` 是 unfiltered 的全局注册表通知，MCP 注册/移除工具时都会触发；preset 插件据此重新发现 `mcp__WolframLanguage__*`、更新 deny 列表，并把 `chat-mode/availability` 写入会话日志。投影把 `availability.wolfram` 推给浏览器，因此菜单项无需刷新即可出现/消失。
- 工具发现使用 **global view**（`ctx.tools.definitions()`），避免“上一轮自己的 deny 把工具隐藏后误判为不存在”；静态包则使用 Agent view 并缓存首次发现结果。
- 对**已存在 Agent 的 preset 切换**，preset 插件的 `session/event` listener 在 `agent-preset/selected` 切到 chat 时立即 `applyRestrictions`，早于下一轮 `tools.resolve`；全局 `agent-preset/selected` 在切走时清理条目，避免 `tools/change` 把 Chat 的 deny 重放到其他 preset。restriction 与 `/permission` 命令随 preset 卸载清理，chat→other→chat 不会重复注册。
- `tools/pre-execute` 兜底：如果某个 batch 在 restriction 变化前已解析，调用被关闭的工具会得到明确的 deny 文本（shell / 联网搜索 / Wolfram 分别提示在“对话设置”中启用）。
- 状态由 log-only 的 `chat-mode/tools` 与 `chat-mode/availability` 事件和 `chatMode` 会话投影持久化，resume/fork 后恢复；旧日志缺少 `wolfram` / `availability` 时按 `false` / 空对象归一化，projection `stateVersion` 仍为 1。
- open turn 期间切换工具不会直接 append；选择先进入内存 pending，在下一个 accepted `agent/pre-step` 写入，restriction 立即按 pending 生效。MCP 可用性变化通过 microtask 去重后 append，避免重入 `session.append()`。
- 注意：agent loop 在 `agent/pre-step` **之前**就 resolve 工具集，因此 pre-step reapply 只影响后续 step；首轮的正确性依靠 Host 提前 pin、`agent/created` prepend 与 `tools/change` 重试。

### 系统指令联动

- `cordis.patch.yml` 的 persona prefix 含 `{{chat_tool_guidance}}`；`preset.js` 在 preset scope 注册该变量，`index.js` 在 global scope 注册返回 `''` 的 fallback（preset scope 覆盖 global）。即使 preset 插件加载失败，persona 的严格插值也不会导致 prompt assembly 报错。
- provider 每次 assembly 都会根据当前会话状态与工具注册表求值：只有 Wolfram 工具**存在且用户已勾选**时，才注入 Wolfram 使用规则：
  - 具体、明确的计算任务、符号推理、形式化变换 → 应当调用 Wolfram 工具；
  - 观点性问题、创意写作、纯粹的语言任务，或近似推理即可满足要求 → 不应当调用；
  - 技能文档位于 `~/.dsh/skills/wolfram-*/`，需要细节时先读对应 `SKILL.md`。
- 未勾选时不注入，避免模型看到“应当调用”但工具实际被 deny 的提示。

### 客户端控件

- 在 `conversation.input.left` 注册 `chat-mode-controls`，只在 `agentPreset === 'chat'` 时渲染。
- 使用 shipped `Menu` 组件与主题 token，弹出层 portal 到 body，避免 composer 裁剪。
- 工具菜单使用 `Menu` 的 `selectedIds` + `selection: 'check'` 多选模式；item 点击只回调 `onSelect`，父组件保持 `open`，因此可以连续勾选。`TOOL_ITEMS` 是数据表，`availableKey` 标记只在投影报告该包可用时才渲染的动态项；Wolfram 图标从 `@local/dsh-wolfram-mcp/client.js` 复制，不新增 `dsh.client.inject` 依赖。
- 工具状态使用乐观 `pendingTools`：勾选立即更新 check 标记与触发器标签，等 `chatMode` 投影追上后清除；命令失败时回滚。**可用性不参与乐观更新**——只读取已落盘的 `liveTools.availability`，否则点击 Wolfram 的瞬间 pending 尚不包含 availability，菜单项会闪烁消失。
- 触发器标签由已选中且可见的项 `join(' + ')` 生成，不再维护固定组合文案；无选中项显示“全部关闭”。
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
- **shipped `/permission` slash picker 仍显示完全权限**：本插件通过 preset 作用域命令拒绝它，但无法修改 shipped picker 的进程目录。输入框左侧的权限下拉框才是推荐入口。
- **CSS 隐藏 shipped 权限控件**：依赖 renderer 的 `data-slot` 锚点；如果未来版本重命名该锚点，控件会重新出现，但 Host 端仍然拒绝完全权限。
- **preset 不是安全沙箱**：DSH 文档明确 presets 可以执行 Host 代码。这里的权限锁是功能/策略层，不是安全边界；真正的文件限制来自 sandbox policy 与 approval。
- **支持在空白会话中切换到 Chat**：`agent-preset/selected` 事件会在下一轮前应用工具 restriction；`/permission` 与 restriction 随 preset 生命周期释放/重注册。已开始（有 turn）的会话仍受 DSH 的 blank-session 限制，不能切换。
- **Host 级工具仍存在**：例如 `team_task_*`、`working_directory` 由 Host 组合提供，所有预设都会继承；它们不做文件内容读写。若需要进一步收紧，可在 Agent 作用域用 `restrict()` 追加。
- **`complete: true` 会抑制工具插件贡献的 prompt guidance**：工具 schema 与 deny 提示仍然存在；本插件通过 `chat_tool_guidance` 变量补充 Chat 自己的规则，未启用 Wolfram 时不注入，避免与工具列表矛盾。
- **动态工具包依赖“MCP 工具为全局注册”**：当前 `mcpManager` 在 root fiber 挂载 `mcp-client`，因此 `ctx.tools.definitions()` 能看到 `mcp__WolframLanguage__*`。若未来出现 preset 局部注册的 MCP 工具，需要把发现函数改为可注入策略。
- **Wolfram 技能文档由 `dsh-wolfram-mcp` 安装**：本插件不复制、不删除 `~/.dsh/skills/wolfram-*`，只在 guidance 中提示路径。

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

**首轮工具列表仍包含持久终端 / 联网搜索 / Wolfram**

- 确认已重启 DSH；Host 半与 preset 插件的变化不会只靠刷新页面生效。
- 检查 `agent/created` listener 是否为 `prepend: true`、`tools/change` 是否在工具注册后重新应用 restriction；若首轮仍出现，说明首轮 `tools.resolve` 确实发生在 restriction 之前，需要采用 FEASIBILITY 13.4.3 的动态挂载方案。

**工具菜单没有 Wolfram / 勾选后模型仍看不到 Wolfram 工具**

- 工具菜单没有 Wolfram：说明当前没有注册的 `mcp__WolframLanguage__*` 工具。打开 Settings → Wolfram MCP 确认 MCP 已连接、工具已加载；MCP 启动较慢时，工具出现后菜单会自动补上（`tools/change` 驱动，无需刷新）。
- 勾选后仍看不到：确认 `chatMode` 投影已更新，且 `tools/pre-execute` 没有 deny；Wolfram 属于动态包，首轮可能因 MCP 尚未连接而缺失，下一 step 会自动出现。
- 若手动调用被 deny，deny 文本会提示在“对话设置”中启用“Wolfram”。

**已勾选 Wolfram，但 system prompt 没有 Wolfram 规则**

- 规则只在“工具存在且本会话已勾选”时注入；MCP 掉线或未勾选时为正常行为。
- 规则是 prompt 变量 `chat_tool_guidance` 的一部分：preset 插件注册真实值，Host 半注册空 fallback。若刷新后仍缺失，确认 preset 插件已加载（`plugin_manager list_plugins` 中 `preset-chat` 为 active），并重启 DSH。

**权限下拉框选“工作区内修改”后仍无法写文件**

- Chat 模式没有 `write`/`edit`/`apply_patch`；只能通过勾选“持久终端”后用 shell 在工作区内写。
- `read-only` 下 shell 写操作会被 sandbox 拒绝，并给出 escalation 提示；切到 `workspace-write` 或批准一次性权限后才可写。
- 确认批准策略为 `ask`（`read-only` / `workspace-write` 的 shipped 配置都是 `ask`）。

**`/permission danger-full-access` 仍然出现在 slash picker**

- 这是 shipped picker 的进程目录行为；Host 端 preset 作用域命令会拒绝该值。使用输入框左侧的权限下拉框，或忽略该行。

**`npm run verify` 报 `no macOS sidecar files` / `no symbolic links`**

- 工作区里的 `.agents/sample/chat-demo` 是官方 Chat 参考源码，自带 `node_modules` 与 `.DS_Store`。构建系统要求插件根目录内全是真实文件；将 `node_modules` 移出插件目录（或删除后重新 `pnpm install`），并清理 `.DS_Store` 后重试。
- 本插件开发时已将参考项目的 `node_modules` 移到 `/tmp/dsh-chat-mode-chat-demo-node_modules`，源码仍在 `.agents/sample/chat-demo`。

**安装/重载后需要重启**

- 如果插件管理器提示 `restart-required`，说明变更触及了运行中的 Host 插件；按提示重启 DSH，不要尝试绕过。

## 版本契约

| 项目            | 值                                                                             |
| --------------- | ------------------------------------------------------------------------------ |
| 插件版本        | `1.2.0`                                                                                                          |
| 包名            | `@local/dsh-chat-mode`                                                                                           |
| Loader entry id | `dsh-chat-mode`                                                                                                  |
| preset id       | `chat`                                                                                                           |
| preset 显示名   | `Chat`                                                                                                           |
| preset order    | `5`                                                                                                              |
| 会话投影 key    | `chatMode`（`{ shell, webSearch, wolfram, availability: { wolfram: boolean } }`）                               |
| 会话事件        | `chat-mode/tools`、`chat-mode/availability`                                                                      |
| 权限命令        | `/permission read-only\|workspace-write`（preset 作用域 shadow）                                                 |
| 工具命令        | `/chat-tools [mode off\|shell\|search\|both\|wolfram\|all] [shell on\|off] [search on\|off] [wolfram on\|off]`   |
| 工具菜单项      | `shell`（持久终端）、`search`（联网搜索）、`wolfram`（Wolfram，按可用性显示），多选                              |
| Wolfram 工具前缀 | `mcp__WolframLanguage__`                                                                                        |
| prompt 变量     | `chat_tool_guidance`（preset scope 覆盖 global fallback）                                                        |
| 客户端 slot     | `conversation.input.left` / id `chat-mode-controls`                                                              |
| locale 命名空间 | `chatMode`                                                                                                       |

行为、接口或契约变化时提升 `package.json` 版本；纯文档改动保持版本。迁移记录与历史对比写入 `FEASIBILITY@<harness-version>.md`。

## 命名约定

- 目录/包：`dsh-chat-mode` / `@local/dsh-chat-mode`
- Loader 行 id：`dsh-chat-mode`；preset 行 id：`preset-chat`
- preset id：`chat`（小写、稳定，被会话日志记录）

---

## 许可证

MIT License，详见 [LICENSE](./LICENSE)。
