# @local/dsh-chat-mode

最后实质性修改于Harness版本：0.2.2-rc.5

在 DSH 中新增一个以纯对话为主的 Agent 预设 **Chat**（preset id：`chat`）：默认只进行文字对话，文件读取需要用户明确要求；持久终端、联网搜索与 Wolfram MCP 工具默认隐藏，由用户在输入框左侧的“工具”菜单中显式启用；权限只允许“仅可查看”和“工作区内修改”，不允许选择“完全权限”。

内置工具之外的工具包是**动态工具包**：Wolfram 是默认包，菜单项只在 `mcp__WolframLanguage__*` 工具存在时出现；其他工具包通过 Settings → **Chat Mode工具配置** 页新增。工具包配置保存在 `~/.dsh/dsh-chat-mode/tools.json`，菜单、模型工具列表与 system prompt 会随配置文件、MCP 注册/移除一起自动更新，无需重启会话。

## 使用与效果

### 选择对话模式

新建会话时，在预设选择器中选择 **Chat**（排在 `order: 5`）。该预设的默认行为：

- 不主动读写工作区文件，也不主动执行命令。
- 普通问答、解释、分析、写作、翻译、头脑风暴直接回答，不为了“确认一下”而读取文件或搜索网络。
- 用户手动附加到对话中的文件，或消息中明确指向的文件，可以直接读取。
- 不提供 `write`、`edit`、`apply_patch`；需要修改文件时，可启用“持久终端”并把权限切到“工作区内修改”，或切换到支持文件编辑的模式。
- `web_fetch` 可以直接读取用户给出的链接；`web_search` 默认关闭。

### 输入框左侧的权限/工具菜单

Chat 会话的输入框左侧会出现两个紧凑下拉框：

| 控件 | 可选值                                             | 效果                                                                                                         |
| ---- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 权限 | 仅可查看 / 工作区内修改                            | 提交 `/permission read-only` 或 `/permission workspace-write`；不提供完全权限。                              |
| 工具 | 持久终端 / 联网搜索 / 自定义工具包（含 Wolfram；可多选，按可用性） | 勾选任意一项即提交 `/chat-tools shell on`、`search on` 或 `<pack-id> on`；再点一次取消。全部不勾选即全部关闭。 |

工具下拉框是**多选菜单**：菜单保持打开，可以连续勾选多项；每项带图标与 check 标记，触发器显示当前组合（关闭 / 持久终端 / 联网搜索 / 自定义工具包，多个启用时用 ` + ` 连接）。持久终端与联网搜索始终显示；自定义工具包只在 Host 状态接口报告该包至少有一个已注册工具时渲染。包被隐藏时不会出现在菜单中，也不会进入模型工具列表。

默认状态：

- 权限：新 Chat 会话在**创建时**即 pin 为 **仅可查看**（早于首轮请求，空白新会话界面也显示正确值）；恢复的 Chat 会话保留已保存的 `read-only` / `workspace-write`，若发现更宽权限则纠正为 `read-only`。
- 工具：所有高级包默认都**不勾选**，即 `bash`/`pwsh`、`web_search`、`mcp__WolframLanguage__*` 以及新增包的工具都不出现在模型工具列表中；不可用的包不显示。
- `read`、`read_image`、`glob`、`grep`、`web_fetch`、`ask_user_question` 始终可用，但由 system prompt 约束为默认不主动使用：仅在用户明确要求，或任务确实依赖该工具的能力时才按需调用。

两个下拉框的外观使用宿主主题 token：带权限/终端/联网/自定义工具图标、胶囊式触发器、hover / focus-visible / active / disabled 状态，以及展开时旋转的 chevron；亮/暗主题自动适配。工具菜单与权限菜单都复用 shipped `Menu` 的 portal、键盘与焦点行为。

### 设置页：Chat Mode工具配置

Settings 中新增 **Chat Mode工具配置** 页，固定排在“Agent 预设文本”和“Wolfram MCP 设置”之间（`settings.section` order `21.5`）。它管理**内置工具之外**的工具包：

- **显示**：每个包显示菜单名称、实际工具名（`prefix*` 或精确名称列表）、可用性、隐藏状态，以及 `chat_tool_guidance` 提示词。
- **新增**：从 Host 当前注册的非内置工具中多选，填写菜单名称与可选提示词；保存后立即写入配置文件并生效。新包默认关闭，需要在“工具”菜单中启用。
- **隐藏/显示**：隐藏只从“工具”菜单移除该菜单项，并暂停其工具与提示词，配置仍保留；可随时重新显示。页面不提供删除。
- **编辑提示词**：每个菜单项都有独立的 guidance 编辑器，提供“提交”和“放弃更改”；提交后下一轮系统提示词即使用新文本，留空则不注入。

配置文件为 `$DSH_HOME/dsh-chat-mode/tools.json`（默认 `~/.dsh/dsh-chat-mode/tools.json`），也可以直接编辑；文件非法时页面显示错误，插件回退到默认 Wolfram 包。菜单名称与工具列表在创建后不在页面内编辑，需要修改时直接编辑配置文件。

可配置的候选中**永久排除** Host 始终注入的五个工具：`list_mcp_resource_templates`、`list_mcp_resources`、`load_workspace_dependencies`、`read_mcp_resource`、`working_directory`。它们由 Host 组合固定注入，插件无法门控；候选列表不显示它们，配置校验也会拒绝手工加入。

### 权限与写入

- 允许的权限预设只有 `read-only` 与 `workspace-write`，两者的 approval policy 都是 `ask`。
- Chat 模式挂载的是持久终端（`@deepseek-ai/dsh-tool-bash-persistent` / `@deepseek-ai/dsh-tool-pwsh-persistent`），其 schema 只有 `command`，没有 `sandbox_permissions` / `justification`；`write` / `edit` / `apply_patch` 也未挂载。因此 Chat **不支持**对单条命令申请一次性更宽权限。
- 需要写入工作区时，请在“工具”菜单启用“持久终端”，并在“权限”菜单切换到“工作区内修改”；`read-only` 下的写操作会被 sandbox 拒绝。
- `danger-full-access` 被 preset 作用域的 `/permission` 命令拒绝；`/permission danger-full-access` 会返回错误，不改变会话权限。
- Chat 会话中，客户端的 shipped 权限控件会被隐藏，改用本插件的两选项下拉框。斜杠命令 `/permission` 仍可用，但其 picker 仍会显示完整进程目录；选择完全权限会被 Host 拒绝。**推荐使用输入框左侧的权限下拉框**。

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

Wolfram 工具**不在 preset 内注册**：它们由 `@local/dsh-wolfram-mcp` 通过 `mcpManager` 注册为全局 MCP 工具。preset 按 `mcp__WolframLanguage__` 前缀动态发现、整包 gate，并在 system prompt 中按需注入 guidance。其他自定义包同理：它们由其他插件/MCP 注册为全局工具，本插件只读取配置、发现工具、执行 restrict，不负责注册工具本身。

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

- `preset.js` 把工具分成两类：
  - **内置包**：shell 与 web_search，写死在 `BUILTIN_PACKS` 中，分别用 `bash`/`pwsh`、`web_search` 发现；
  - **自定义包**：从 `$DSH_HOME/dsh-chat-mode/tools.json` 读取，每个包用 `prefix`（Wolfram）或 `tools`（精确名称列表）声明它负责的工具，并带 `label`、`icon`、可选 `guidance` 与 `hidden`。
- preset 插件在每个 Chat Agent 的 `agent.ctx.tools` 上注册 `restrict({ deny })`：未启用的包整包隐藏；自定义包被隐藏（`hidden: true`）时也同样整包 deny，即使会话此前已勾选。用户启用后 dispose 对应 restriction，下一次 step 的工具 schema 出现。
- `agent/created` listener 使用 `prepend: true`，尽量早于普通 creation observer；内置包的 `known` 为空时不缓存，并在 `tools/change` 时对已知 Chat Agent 重新应用 restriction，避免“首轮包含、第二轮才移除”。
- **动态工具包**：`tools/change` 是 unfiltered 的全局注册表通知，MCP 注册/移除工具、其他插件注册工具时都会触发；preset 插件据此重新发现自定义包的工具并更新 deny 列表。Client 半每 3 秒轮询 owner-only 的 `GET /dsh-chat-mode/api/state`，据此显示/隐藏自定义菜单项，无需刷新页面。
- 工具发现使用 **global view**（`ctx.tools.definitions()`），避免“上一轮自己的 deny 把工具隐藏后误判为不存在”；内置包则使用 Agent view 并缓存首次发现结果。
- **保存即时生效**：设置页通过 `POST/PATCH /dsh-chat-mode/api/tools` 写入配置文件后，Host 半发出进程内事件 `chat-mode/config-changed`；preset 半清空配置缓存并对已知 Chat Agent 重新执行 `applyRestrictions`，下一轮 prompt assembly 也会读取新的 guidance。配置变化不写入 Session。
- 对**已存在 Agent 的 preset 切换**，preset 插件的 `session/event` listener 在 `agent-preset/selected` 切到 chat 时立即 `applyRestrictions`，早于下一轮 `tools.resolve`；全局 `agent-preset/selected` 在切走时清理条目，避免 `tools/change` 把 Chat 的 deny 重放到其他 preset。restriction 与 `/permission` 命令随 preset 卸载清理，chat→other→chat 不会重复注册。
- `tools/pre-execute` 兜底：如果某个 batch 在 restriction 变化前已解析，调用被关闭或隐藏的工具会得到明确的 deny 文本。
- 状态由**已知的** `command/run` + `command/done` 事件和 `chatMode` 会话投影持久化：`/chat-tools` 成功执行时，投影根据命令参数折叠出 `{ shell, webSearch, custom }`，resume/fork 后恢复；**不写任何插件自定义会话事件**（未知事件类型无法通过 `Session.append()` 带 `ignorable` 标记，会导致会话无法重开）。projection `stateVersion` 为 3。
- 注意：agent loop 在 `agent/pre-step` **之前**就 resolve 工具集，因此 pre-step reapply 只影响后续 step；首轮的正确性依靠 Host 提前 pin、`agent/created` prepend 与 `tools/change` 重试。

### 系统指令联动

- `cordis.patch.yml` 的 persona prefix 含 `{{chat_tool_guidance}}`；`preset.js` 在 preset scope 注册该变量，`index.js` 在 global scope 注册返回 `''` 的 fallback（preset scope 覆盖 global）。即使 preset 插件加载失败，persona 的严格插值也不会导致 prompt assembly 报错。
- provider 每次 assembly 都会根据当前会话状态、配置包与工具注册表求值：对每个 `guidance` 非空、未隐藏、已勾选且至少有一个已注册工具的自定义包，注入其 guidance。默认 Wolfram 包的内容包括：
  - 复杂、易错或需要高可靠性的计算、符号推导、数据处理、可视化、形式化验证 → 应当调用 Wolfram 工具；
  - 简单常识算术、观点性问题、创意写作、纯粹的语言任务，或定性解释即可满足 → 直接以文字作答，不调用 Wolfram 工具；
  - 技能文档位于 `~/.dsh/skills/wolfram-*/`，需要细节时先读对应 `SKILL.md`。
- 自定义包的 guidance 可以在设置页编辑；`guidance` 为空时不注入任何文本。
- `complete: true` 会抑制工具插件贡献的 prompt section；Chat 的 persona 显式补上了 read / glob / grep 的工具偏好、`web_fetch` / `web_search` 的外部不可信内容与引用要求，以及持久终端的写入/权限流程。
- 未勾选、隐藏或不可用时不注入，避免模型看到“应当调用”但工具实际被 deny 的提示。

### 客户端控件

- 在 `conversation.input.left` 注册 `chat-mode-controls`，只在 `agentPreset === 'chat'` 时渲染。
- 使用 shipped `Menu` 组件与主题 token，弹出层 portal 到 body，避免 composer 裁剪。
- 工具菜单使用 `Menu` 的 `selectedIds` + `selection: 'check'` 多选模式；item 点击只回调 `onSelect`，父组件保持 `open`，因此可以连续勾选。`BUILTIN_TOOL_ITEMS` 固定提供 `shell` / `search`；自定义项来自 Host `GET /dsh-chat-mode/api/state` 的 `custom` 数组，按 `available` 过滤。图标映射为 `{ wolfram: WolframMcpIcon, default: ToolsIcon }`，未知值回退默认图标；Wolfram 图标从 `@local/dsh-wolfram-mcp/client.js` 复制，不新增 `dsh.client.inject` 依赖。
- 工具状态使用乐观 `pendingTools`：勾选立即更新 check 标记与触发器标签，等 `chatMode` 投影追上后清除；命令失败时回滚。**可用性不参与乐观更新**——它只来自 Host 接口的轮询结果，避免点击刚出现的自定义项时因 pending 更新而闪烁消失。
- 触发器标签由已选中且可见的项 `join(' + ')` 生成；内置项使用 locale 文案，自定义项使用配置的 `label`；无选中项显示“全部关闭”。
- 新增 `settings.section`（id `chat-mode-tools`，order `21.5`）与 `settings.section.icon`：显示、新增、隐藏工具包，并为每个包提供独立的 guidance 编辑器（“提交” / “放弃更改”）。页面通过同一个 owner-only API 读写配置文件，不修改 profile 配置。
- 权限菜单使用 `selectedId` 单选；两个菜单的 item 都带图标，触发器使用主题 token 的胶囊样式。
- 权限与工具下拉框都通过 `session.command()` 提交，执行路径与 shipped 控件一致。
- 中英文文案由 Client locale 的 `chatMode` 命名空间提供，设置页复用同一命名空间。

## 依赖与构建

本插件是**零运行时依赖**的 bundle：

- Host 半 `index.js` 与 `preset.js` 只 import 本地 `config.js`；`config.js` 只用 Node 内置模块（`node:fs` / `node:os` / `node:path` / `node:crypto`）。
- `preset.js` 不 import `zod` 或 `defineTool`，只通过 Cordis context 使用 DSH 服务。
- `client.js` 只 require baseline 的 `react` 与 `@deepseek-ai/dsh-client-ui-primitives`。
- 因此 `package.json` 不声明 `dependencies`，构建系统走“不建树”分支；`files[]` 包含 `config.js`。

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

- **不提供文件修改工具**：没有 `write`、`edit`、`apply_patch`。如需修改文件，可启用“持久终端”并切到“工作区内修改”，或切换到 `standard` / `ptc` 等模式。
- **不提供 Office、技能、Goal、Plan、Todo、Subagent、Workflow、日程、后台 jobs** 等工具；这是“纯对话”的刻意裁剪。
- **shipped `/permission` slash picker 仍显示完全权限**：本插件通过 preset 作用域命令拒绝它，但无法修改 shipped picker 的进程目录。输入框左侧的权限下拉框才是推荐入口。
- **CSS 隐藏 shipped 权限控件**：依赖 renderer 的 `data-slot` 锚点；如果未来版本重命名该锚点，控件会重新出现，但 Host 端仍然拒绝完全权限。
- **preset 不是安全沙箱**：DSH 文档明确 presets 可以执行 Host 代码。这里的权限锁是功能/策略层，不是安全边界；真正的文件限制来自 sandbox policy 与 approval。
- **支持在空白会话中切换到 Chat**：`agent-preset/selected` 事件会在下一轮前应用工具 restriction；`/permission` 与 restriction 随 preset 生命周期释放/重注册。已开始（有 turn）的会话仍受 DSH 的 blank-session 限制，不能切换。
- **Host 级工具部分可配置**：例如 `team_task_*` 等 Host 工具在设置页候选列表中，可以加入自定义包并由 Chat 门控；但 Host 始终注入的 `list_mcp_resource_templates`、`list_mcp_resources`、`load_workspace_dependencies`、`read_mcp_resource`、`working_directory` 不在此列，插件无法门控它们。内置工具（read/read_image/glob/grep/web_fetch/ask_user_question、持久终端、web_search）同样不在此列。
- **设置页不提供删除**：隐藏只会从“工具”菜单移除菜单项并暂停其工具与提示词，配置仍保留；需要彻底移除时直接编辑配置文件。菜单名称、工具列表和图标在创建后不在页面内编辑。
- **新包默认关闭**：保存后包立即进入 deny 列表并出现在菜单中，需要用户在“工具”菜单启用；这与现有 Wolfram 行为一致。
- **图标只支持 `wolfram` / `default`**：配置文件的 `icon` 值只映射到插件内的两个渲染器；未知值回退默认图标，不执行配置中的任意代码。
- **配置文件非法时回退默认**：默认 Wolfram 包继续生效；设置页显示错误并禁止写回，避免覆盖用户内容。文件缺失时 Host 半会在启动时创建默认文件（失败则仅使用内存默认值）。
- **`/chat-tools mode all` 保持旧语义**：shell + web_search + Wolfram；其他自定义包用 `/chat-tools <pack-id> on|off` 单独切换。
- **`complete: true` 会抑制工具插件贡献的 prompt guidance**：工具 schema 与 deny 提示仍然存在；本插件在 persona prefix 中补充 Chat 自己的规则，并通过 `chat_tool_guidance` 变量注入每个启用且可用的自定义包 guidance，未启用/隐藏/不可用时不注入，避免与工具列表矛盾。
- **动态工具包依赖“非内置工具在全局注册表可见”**：当前 `mcpManager` 在 root fiber 挂载 `mcp-client`，其他 Host 工具也在 root 组合中，因此 `ctx.tools.definitions()` 能看到它们。若未来出现 preset 局部注册的非内置工具，需要把发现函数改为可注入策略。
- **Wolfram 技能文档由 `dsh-wolfram-mcp` 安装**：本插件不复制、不删除 `~/.dsh/skills/wolfram-*`，只在 guidance 中提示路径。

## 故障排查

**预设列表里没有 Chat**

- `plugin_manager list_bundles` 确认 `@local/dsh-chat-mode` 已安装。
- `plugin_manager list_plugins` 搜索 `preset-chat`，确认 `enabled: true`、`fiberPhase: active`。
- 检查 `cordis.patch.yml` 的 `id: preset-chat` 与 `config.id: chat`；改完重新安装/重载。
- 新建会话才使用新预设；已有会话保留其原组合。

**输入框左侧没有权限/工具菜单**

- 确认当前会话的 preset 是 `chat`（会话头的预设标签）。
- 刷新页面；客户端半是浏览器模块，安装后需要重新加载。
- 浏览器控制台若提示 `@local/dsh-chat-mode` 模块加载失败，检查 `client.js` 是否可解析、`dsh.client.inject` 是否列出了 `@deepseek-ai/dsh-client-ui-primitives` 等包。
- 非 Chat 会话不显示该控件；这是设计行为。

**工具菜单勾选“持久终端”后模型仍没有 bash**

- 确认当前会话是 Chat，且 `chatMode` 投影已更新（切换后通常下一次 step 生效）。
- 若在模型运行中切换，选择会在下一个 accepted pre-step 写入；工具 schema 可能要到下一轮才出现。
- 检查 `agent.ctx.tools.schemas(agent)` 是否包含 `bash`；若包含但模型不调用，检查 system prompt 是否允许在用户要求运行命令或修改文件时按需调用。

**首轮工具列表仍包含持久终端 / 联网搜索 / 自定义工具包**

- 确认已重启 DSH；Host 半与 preset 插件的变化不会只靠刷新页面生效。
- 检查 `agent/created` listener 是否为 `prepend: true`、`tools/change` 是否在工具注册后重新应用 restriction；若首轮仍出现，说明首轮 `tools.resolve` 确实发生在 restriction 之前，需要采用 FEASIBILITY 13.4.3 的动态挂载方案。

**工具菜单没有某个自定义包 / 勾选后模型仍看不到其工具**

- 工具菜单没有该包：确认 `GET /dsh-chat-mode/api/state` 的 `custom` 中包含该包且 `available: true`、`hidden: false`。Wolfram 需要 Settings → Wolfram MCP 确认 MCP 已连接、`mcp__WolframLanguage__*` 已注册；其他包需要对应插件/工具已注册。
- 勾选后仍看不到：确认 `tools/pre-execute` 没有 deny，且该包的工具在 `agent.ctx.tools.schemas(agent)` 中；动态包在工具注册后下一次轮询会自动补上。
- 若手动调用被 deny，deny 文本会提示在“工具”菜单中启用，或在设置页显示被隐藏的包。

**Settings 中没有“Chat Mode工具配置”**

- 确认插件已安装并启用、页面已刷新；设置页是客户端 slot，安装后需要重新加载浏览器模块。
- 该页固定 `settings.section` order `21.5`；如果另一个插件也用同一 id/顺序，检查 `plugin_manager list_plugins` 与浏览器控制台的 slot 错误。
- Host 半的 API 不可用时，页面会显示请求失败；确认 DSH 已重启以加载新的 Host 半。

**新增工具包保存后菜单没有出现**

- 新包默认关闭：保存后需要在输入框左侧“工具”菜单中启用。
- 包的 `available` 为 false：对应工具当前没有注册；在设置页会显示“不可用”，等工具注册后自动出现。
- 包被隐藏：设置页显示“已隐藏”，点击“显示”恢复。
- 若菜单与设置页都看不到，检查 `~/.dsh/dsh-chat-mode/tools.json` 是否合法、`GET /dsh-chat-mode/api/state` 是否返回 `custom`。

**guidance 没有进入系统提示词**

- 该包的 guidance 为空、包被隐藏、未勾选或没有可用工具时不会注入。
- 设置页“提交”后下一轮 prompt assembly 才读取新值；检查 `chat_tool_guidance` 变量是否由 preset 半注册（`plugin_manager list_plugins` 中 `preset-chat` 为 active）。
- 编辑 guidance 后没有提交：页面会显示“有未提交的更改”；点击“提交”或“放弃更改”。

**配置文件错误 / 页面提示“配置文件错误”**

- 文件位于 `~/.dsh/dsh-chat-mode/tools.json`（或 `$DSH_HOME/...`）；页面顶部会显示解析/校验错误。
- 修复 JSON 或字段后保存，下一轮生效；修好后页面重新加载即可继续新增。
- 文件缺失时 Host 半会在启动时写入默认内容；如果目录不可写，插件仍用内存默认值工作，设置页的保存会返回错误。

**已勾选 Wolfram，但 system prompt 没有 Wolfram 规则**

- 规则只在“Wolfram 包未隐藏、工具存在且本会话已勾选”时注入；MCP 掉线、包被隐藏或未勾选时为正常行为。
- 规则是 prompt 变量 `chat_tool_guidance` 的一部分：preset 插件注册真实值，Host 半注册空 fallback。设置页编辑后需要点击“提交”；若刷新后仍缺失，确认 preset 插件已加载（`plugin_manager list_plugins` 中 `preset-chat` 为 active），并重启 DSH。

**打开历史 Chat 会话时报 `contains event type "chat-mode/..." unknown ... not marked ignorable`**

- 这是 1.2.0 的缺陷：它用 `Session.append()` 写入了 `chat-mode/tools` 与 `chat-mode/availability`；未知事件类型无法带 `ignorable: true`，重启后读取器会拒绝解释该日志。
- 1.2.1 已不再写任何插件自定义事件：`/chat-tools` 的选择由已知的 `command/run` + `command/done` 折叠，自定义包可用性由 Host 接口提供。
- 修复旧日志：

  ```sh
  node scripts/repair-session-events.mjs --write <session.v4.jsonl.zstd>
  ```

  脚本会在同目录生成时间戳备份，再为这两个旧事件补 `ignorable: true` 并原子替换；已修复的日志会保留旧事件但安全跳过。`scripts/` 不随插件安装，需在插件源码目录运行。

**权限下拉框选“工作区内修改”后仍无法写文件**

- Chat 模式没有 `write`/`edit`/`apply_patch`；只能通过勾选“持久终端”后用 shell 在工作区内写。
- `read-only` 下 shell 写操作会被 sandbox 拒绝；切到“工作区内修改”后才可写。
- 持久终端的 schema 没有 `sandbox_permissions` / `justification`，本模式不支持对单条命令临时提权。
- 如果切换权限时持久终端已经打开，`terminal-bash` 的 sandbox mode fence 会拒绝 `sandbox/mode` 切换；先关闭“持久终端”再切换权限（这是现有运行时行为，后续可单独优化）。
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
| 插件版本        | `1.4.1`                                                                                                          |
| 包名            | `@local/dsh-chat-mode`                                                                                           |
| Loader entry id | `dsh-chat-mode`                                                                                                  |
| preset id       | `chat`                                                                                                           |
| preset 显示名   | `Chat`                                                                                                           |
| preset order    | `5`                                                                                                              |
| 会话投影 key    | `chatMode`（`{ shell, webSearch, custom }`，stateVersion `3`，由 `/chat-tools` 命令事件折叠）                    |
| 工具配置文件    | `$DSH_HOME/dsh-chat-mode/tools.json`（默认 `~/.dsh/dsh-chat-mode/tools.json`，schema version `1`）               |
| 设置页          | `settings.section` id `chat-mode-tools`，order `21.5`                                                            |
| 设置页 API      | `GET /tools`、`POST /tools`、`PATCH /tools`、`GET /candidates`（均在 `/dsh-chat-mode/api` 下，owner-only）        |
| 可用性接口      | `GET /dsh-chat-mode/api/state` → `{ ok: true, result: { wolfram, custom, configPath, configError } }`（owner-only） |
| 插件自定义事件  | 无（仅进程内事件 `chat-mode/config-changed`，不写入 Session）                                                     |
| 权限命令        | `/permission read-only\|workspace-write`（preset 作用域 shadow）                                                 |
| 工具命令        | `/chat-tools [mode off\|shell\|search\|both\|wolfram\|all] [shell on\|off] [search on\|off] [<pack-id> on\|off]` |
| 工具菜单项      | `shell`（持久终端）、`search`（联网搜索）、自定义包（默认 `wolfram`，按可用性显示、可隐藏），多选               |
| 始终注入工具    | `list_mcp_resource_templates`、`list_mcp_resources`、`load_workspace_dependencies`、`read_mcp_resource`、`working_directory`（不入候选、配置校验拒绝） |
| Wolfram 工具前缀 | `mcp__WolframLanguage__`                                                                                        |
| prompt 变量     | `chat_tool_guidance`（preset scope 覆盖 global fallback）                                                        |
| 客户端 slot     | `conversation.input.left` / `chat-mode-controls`；`settings.section` / `chat-mode-tools`；`settings.section.icon` / `chat-mode-tools` |
| locale 命名空间 | `chatMode`                                                                                                       |

行为、接口或契约变化时提升 `package.json` 版本；纯文档改动保持版本。迁移记录与历史对比写入 `FEASIBILITY@<harness-version>.md`。

## 命名约定

- 目录/包：`dsh-chat-mode` / `@local/dsh-chat-mode`
- Loader 行 id：`dsh-chat-mode`；preset 行 id：`preset-chat`
- preset id：`chat`（小写、稳定，被会话日志记录）

---

## 许可证

MIT License，详见 [LICENSE](./LICENSE)。
