/**
 * Custom tool-pack configuration for chat mode.
 *
 * The built-in packs — the always-visible read/search tools, the persistent
 * shell, and web_search — stay hard-coded in `preset.js` and cannot be
 * configured. Every other pack is described by a JSON document in the DSH data
 * directory:
 *
 *     $DSH_HOME/dsh-chat-mode/tools.json   (default: ~/.dsh/...)
 *
 * The file is plugin-owned state, not DSH profile configuration: it survives
 * disable/re-enable, is safe to edit by hand, and is read by both Host halves
 * through this one module. The module imports only Node builtins so the
 * package keeps its empty dependency tree.
 *
 * A pack is one Tools-menu item and one or more model-facing tools:
 *
 *     { id, label, icon, prefix?, tools?, guidance, hidden? }
 *
 * - `prefix` matches a dynamic tool family (the Wolfram MCP namespace);
 * - `tools` lists exact model-facing tool names;
 * - `icon` selects a renderer from the Client half's icon table; unknown
 *   values fall back to the shared default icon;
 * - `guidance` is folded under the chat persona's `chat_tool_guidance`
 *   placeholder while the pack is visible, enabled, available, and non-empty;
 * - `hidden` removes the pack from the Tools menu and suspends its tools and
 *   guidance without deleting the configuration.
 */

import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/** Only configuration document version this module understands. */
export const CONFIG_VERSION = 1;

/** Directory under `$DSH_HOME` owned by this plugin. */
export const CONFIG_DIR_NAME = 'dsh-chat-mode';

/** Configuration file name inside {@link CONFIG_DIR_NAME}. */
export const CONFIG_FILE_NAME = 'tools.json';

/** Environment variable that overrides the default DSH home. */
export const DSH_HOME_ENV = 'DSH_HOME';

/** Stable id of the default Wolfram pack. */
export const WOLFRAM_PACK_ID = 'wolfram';

/** Stable model-facing namespace of the Wolfram MCP server. */
export const WOLFRAM_PREFIX = 'mcp__WolframLanguage__';

/**
 * Tool names owned by the built-in chat composition. They never appear in the
 * configuration file's `tools` lists and are excluded from the settings page's
 * candidate list.
 */
export const BUILTIN_TOOL_NAMES = Object.freeze([
  'read',
  'read_image',
  'glob',
  'grep',
  'web_fetch',
  'ask_user_question',
  'bash',
  'pwsh',
  'web_search',
  'write',
  'edit',
  'apply_patch',
]);

/**
 * Host-provided tools that the chat composition always injects. They cannot be
 * gated or configured by a pack, so they are permanently excluded from the
 * settings page's candidate list and rejected by configuration validation.
 */
export const ALWAYS_INJECTED_TOOL_NAMES = Object.freeze([
  'list_mcp_resource_templates',
  'list_mcp_resources',
  'load_workspace_dependencies',
  'read_mcp_resource',
  'working_directory',
]);

const BUILTIN_TOOL_SET = new Set(BUILTIN_TOOL_NAMES);
const ALWAYS_INJECTED_TOOL_SET = new Set(ALWAYS_INJECTED_TOOL_NAMES);

/** Pack ids reserved by the built-in packs and the default Wolfram pack. */
export const RESERVED_PACK_IDS = Object.freeze(['shell', 'search', WOLFRAM_PACK_ID]);

/** Guidance injected while the default Wolfram pack is enabled and available. */
export const WOLFRAM_GUIDANCE = [
  'Wolfram 工具：',
  '- 当前会话已启用 Wolfram Language 工具（mcp__WolframLanguage__*），它们已经出现在工具列表中，可直接调用，无需再向用户确认是否启用。',
  '- 当任务涉及心算容易出错或需要高可靠性的计算（复杂数值计算、符号推导、方程求解、数据处理、单位与科学实体换算、数学可视化、形式化验证等）时，应当调用 Wolfram 工具，而不是凭近似估算作答。',
  '- 当问题属于简单常识算术、观点讨论、创意写作、纯粹的语言任务，或定性解释即可满足需求时，直接以文字作答，不要调用 Wolfram 工具。',
  '- Wolfram 技能文档位于 `~/.dsh/skills/wolfram-*/`（wolfram-language、wolfram-notebooks、wolfram-paclets、wolfram-debugging）；需要更详细的用法时，先阅读对应目录下的 SKILL.md。',
].join('\n');

/** Maximum characters accepted for a pack label. */
const MAX_LABEL_LENGTH = 64;

/** Maximum characters accepted for one pack's guidance. */
const MAX_GUIDANCE_LENGTH = 16_000;

/** Maximum characters accepted for one prefix. */
const MAX_PREFIX_LENGTH = 200;

/**
 * Return whether a value is a plain JSON object.
 * @param {unknown} value - candidate.
 * @returns {boolean}
 */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Render validation errors as one human-readable line.
 * @param {Array<{ path: string, message: string }>} errors - validation errors.
 * @returns {string}
 */
export function errorText(errors) {
  return errors.map((error) => `${error.path}: ${error.message}`).join('; ');
}

/** Expand a leading `~` and resolve the path. */
function expandHome(value) {
  if (value === '~') return homedir();
  if (value.startsWith('~/') || value.startsWith('~\\')) return join(homedir(), value.slice(2));
  return resolve(value);
}

/**
 * Resolve the DSH data root with the same precedence as `@deepseek-ai/dsh-home-paths`.
 * @param {Record<string, string | undefined>} [env] - environment mapping.
 * @returns {string} absolute DSH home.
 */
export function resolveDshHome(env = process.env) {
  const raw = typeof env?.[DSH_HOME_ENV] === 'string' ? env[DSH_HOME_ENV].trim() : '';
  return raw === '' ? join(homedir(), '.dsh') : expandHome(raw);
}

/**
 * Resolve the absolute configuration file path.
 * @param {Record<string, string | undefined>} [env] - environment mapping.
 * @returns {string} absolute path.
 */
export function resolveConfigPath(env = process.env) {
  return join(resolveDshHome(env), CONFIG_DIR_NAME, CONFIG_FILE_NAME);
}

/**
 * Resolve the symbolic path shown to users (`~/.dsh/...` or `$DSH_HOME/...`).
 * @param {Record<string, string | undefined>} [env] - environment mapping.
 * @returns {string} display path.
 */
export function displayConfigPath(env = process.env) {
  const raw = typeof env?.[DSH_HOME_ENV] === 'string' ? env[DSH_HOME_ENV].trim() : '';
  const relative = `${CONFIG_DIR_NAME}/${CONFIG_FILE_NAME}`;
  return raw === '' ? `~/.dsh/${relative}` : `$DSH_HOME/${relative}`;
}

/**
 * Build a fresh default configuration holding only the Wolfram pack.
 * @returns {{ version: number, tools: Array<Record<string, unknown>> }}
 */
export function defaultConfig() {
  return {
    version: CONFIG_VERSION,
    tools: [
      {
        id: WOLFRAM_PACK_ID,
        label: 'Wolfram',
        icon: 'wolfram',
        prefix: WOLFRAM_PREFIX,
        guidance: WOLFRAM_GUIDANCE,
      },
    ],
  };
}

/**
 * Whether a pack claims one model-facing tool name.
 * @param {Record<string, unknown>} pack - normalized pack.
 * @param {string} name - tool name.
 * @returns {boolean}
 */
export function toolInConfig(pack, name) {
  if (typeof pack?.prefix === 'string' && name.startsWith(pack.prefix)) return true;
  return Array.isArray(pack?.tools) && pack.tools.includes(name);
}

/**
 * Whether two packs claim overlapping tool names.
 * @param {Record<string, unknown>} left - normalized pack.
 * @param {Record<string, unknown>} right - normalized pack.
 * @returns {boolean}
 */
function packsOverlap(left, right) {
  const leftPrefix = typeof left.prefix === 'string' ? left.prefix : undefined;
  const rightPrefix = typeof right.prefix === 'string' ? right.prefix : undefined;
  const leftTools = Array.isArray(left.tools) ? left.tools : [];
  const rightTools = Array.isArray(right.tools) ? right.tools : [];
  const prefixesOverlap = (a, b) => a !== undefined && b !== undefined && (a.startsWith(b) || b.startsWith(a));
  if (prefixesOverlap(leftPrefix, rightPrefix)) return true;
  if (leftPrefix !== undefined && rightTools.some((name) => name.startsWith(leftPrefix) || leftPrefix.startsWith(name))) {
    return true;
  }
  if (rightPrefix !== undefined && leftTools.some((name) => name.startsWith(rightPrefix) || rightPrefix.startsWith(name))) {
    return true;
  }
  return leftTools.some((name) => rightTools.includes(name));
}

/**
 * Validate one pack and append its normalized form to `tools`.
 * @param {unknown} raw - candidate pack.
 * @param {number} index - array index for error paths.
 * @param {{ errors: Array<{path: string, message: string}>, tools: Array<Record<string, unknown>>, ids: Set<string>, labels: Set<string> }} state - accumulated validation state.
 */
function normalizePack(raw, index, state) {
  const base = `$.tools[${index}]`;
  if (!isPlainObject(raw)) {
    state.errors.push({ path: base, message: '必须是对象' });
    return;
  }
  if (typeof raw.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/u.test(raw.id)) {
    state.errors.push({ path: `${base}.id`, message: '必须是小写字母/数字/连字符组成的非空字符串' });
    return;
  }
  if (raw.id === 'shell' || raw.id === 'search') {
    state.errors.push({ path: `${base}.id`, message: `"${raw.id}" 是内置工具包保留 id` });
    return;
  }
  if (state.ids.has(raw.id)) {
    state.errors.push({ path: `${base}.id`, message: `重复的包 id：${raw.id}` });
    return;
  }
  const label = typeof raw.label === 'string' ? raw.label.trim() : '';
  if (label === '') {
    state.errors.push({ path: `${base}.label`, message: '必须是非空字符串' });
    return;
  }
  if (label.length > MAX_LABEL_LENGTH) {
    state.errors.push({ path: `${base}.label`, message: `不能超过 ${MAX_LABEL_LENGTH} 个字符` });
    return;
  }
  const labelKey = label.toLowerCase();
  if (state.labels.has(labelKey)) {
    state.errors.push({ path: `${base}.label`, message: `重复的菜单名称：${label}` });
    return;
  }
  let icon = 'default';
  if (raw.icon !== undefined) {
    if (typeof raw.icon !== 'string') {
      state.errors.push({ path: `${base}.icon`, message: '必须是字符串' });
      return;
    }
    icon = raw.icon === 'wolfram' ? 'wolfram' : 'default';
  }
  let prefix;
  if (raw.prefix !== undefined) {
    if (typeof raw.prefix !== 'string') {
      state.errors.push({ path: `${base}.prefix`, message: '必须是字符串' });
      return;
    }
    prefix = raw.prefix.trim();
    if (prefix === '' || prefix.length > MAX_PREFIX_LENGTH) {
      state.errors.push({ path: `${base}.prefix`, message: `必须是非空字符串且不超过 ${MAX_PREFIX_LENGTH} 个字符` });
      return;
    }
  }
  let names;
  if (raw.tools !== undefined) {
    if (!Array.isArray(raw.tools)) {
      state.errors.push({ path: `${base}.tools`, message: '必须是数组' });
      return;
    }
    names = [];
    for (const value of raw.tools) {
      if (typeof value !== 'string' || value.trim() === '') {
        state.errors.push({ path: `${base}.tools`, message: '每项必须是非空字符串' });
        return;
      }
      const name = value.trim();
      if (BUILTIN_TOOL_SET.has(name)) {
        state.errors.push({ path: `${base}.tools`, message: `"${name}" 是内置工具，不能配置` });
        return;
      }
      if (ALWAYS_INJECTED_TOOL_SET.has(name)) {
        state.errors.push({ path: `${base}.tools`, message: `"${name}" 是 Host 始终注入的工具，不能配置` });
        return;
      }
      if (!names.includes(name)) names.push(name);
    }
  }
  if (prefix === undefined && (names === undefined || names.length === 0)) {
    state.errors.push({ path: base, message: 'prefix 与 tools 至少提供一个' });
    return;
  }
  const guidance = raw.guidance === undefined ? '' : raw.guidance;
  if (typeof guidance !== 'string') {
    state.errors.push({ path: `${base}.guidance`, message: '必须是字符串' });
    return;
  }
  if (guidance.length > MAX_GUIDANCE_LENGTH) {
    state.errors.push({ path: `${base}.guidance`, message: `不能超过 ${MAX_GUIDANCE_LENGTH} 个字符` });
    return;
  }
  if (raw.hidden !== undefined && typeof raw.hidden !== 'boolean') {
    state.errors.push({ path: `${base}.hidden`, message: '必须是布尔值' });
    return;
  }
  const pack = { id: raw.id, label, icon };
  if (prefix !== undefined) pack.prefix = prefix;
  if (names !== undefined && names.length > 0) pack.tools = names;
  pack.guidance = guidance;
  if (raw.hidden === true) pack.hidden = true;
  for (const previous of state.tools) {
    if (packsOverlap(pack, previous)) {
      state.errors.push({ path: `${base}.tools`, message: `与工具包 "${previous.id}" 的工具范围重叠` });
      return;
    }
  }
  state.ids.add(pack.id);
  state.labels.add(labelKey);
  state.tools.push(pack);
}

/**
 * Validate and normalize a whole configuration document.
 * @param {unknown} raw - parsed JSON value.
 * @returns {{ ok: boolean, config: object | null, errors: Array<{path: string, message: string}> }}
 */
export function normalizeConfig(raw) {
  const errors = [];
  if (!isPlainObject(raw)) {
    return { ok: false, config: null, errors: [{ path: '$', message: '配置必须是 JSON 对象' }] };
  }
  const version = raw.version === undefined ? CONFIG_VERSION : raw.version;
  if (version !== CONFIG_VERSION) {
    return {
      ok: false,
      config: null,
      errors: [{ path: '$.version', message: `不支持的配置版本：${String(version)}（当前为 ${CONFIG_VERSION}）` }],
    };
  }
  if (!Array.isArray(raw.tools)) {
    return { ok: false, config: null, errors: [{ path: '$.tools', message: '必须是数组' }] };
  }
  const state = { errors, tools: [], ids: new Set(), labels: new Set() };
  raw.tools.forEach((entry, index) => {
    normalizePack(entry, index, state);
  });
  if (errors.length > 0) return { ok: false, config: null, errors };
  return { ok: true, config: { version: CONFIG_VERSION, tools: state.tools }, errors: [] };
}

/** Process-level cache keyed by the absolute configuration path. */
const configCache = new Map();

/**
 * Drop one path's cached read, or the whole cache.
 * @param {string} [path] - absolute configuration path.
 */
export function invalidateConfigCache(path) {
  if (path === undefined) configCache.clear();
  else configCache.delete(path);
}

/**
 * Read one configuration file, using the mtime/size cache when possible.
 * @param {string} path - absolute configuration path.
 * @returns {{ config: object, error: string | null, exists: boolean }}
 */
function readConfigFromDisk(path) {
  let stat;
  try {
    stat = statSync(path);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { config: defaultConfig(), error: null, exists: false };
    }
    return {
      config: defaultConfig(),
      error: `无法读取工具配置：${error instanceof Error ? error.message : String(error)}`,
      exists: false,
    };
  }
  const cached = configCache.get(path);
  if (cached !== undefined && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.result;
  }
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    return {
      config: defaultConfig(),
      error: `无法读取工具配置：${error instanceof Error ? error.message : String(error)}`,
      exists: true,
    };
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    const result = {
      config: defaultConfig(),
      error: `工具配置不是有效 JSON：${error instanceof Error ? error.message : String(error)}`,
      exists: true,
    };
    configCache.set(path, { mtimeMs: stat.mtimeMs, size: stat.size, result });
    return result;
  }
  const normalized = normalizeConfig(raw);
  const result = normalized.ok
    ? { config: normalized.config, error: null, exists: true }
    : { config: defaultConfig(), error: `工具配置校验失败：${errorText(normalized.errors)}`, exists: true };
  configCache.set(path, { mtimeMs: stat.mtimeMs, size: stat.size, result });
  return result;
}

/**
 * Read the effective configuration.
 * @param {Record<string, string | undefined>} [env] - environment mapping.
 * @returns {{ config: object, error: string | null, exists: boolean, path: string, displayPath: string }}
 */
export function getToolsConfig(env = process.env) {
  const path = resolveConfigPath(env);
  const read = readConfigFromDisk(path);
  return { ...read, path, displayPath: displayConfigPath(env) };
}

/**
 * Write one configuration document atomically and refresh the cache.
 * @param {unknown} config - candidate document.
 * @param {Record<string, string | undefined>} [env] - environment mapping.
 * @returns {{ ok: boolean, config?: object, path?: string, error?: string }}
 */
export function writeToolsConfig(config, env = process.env) {
  const normalized = normalizeConfig(config);
  if (!normalized.ok) return { ok: false, error: errorText(normalized.errors) };
  const path = resolveConfigPath(env);
  let temporary;
  try {
    mkdirSync(dirname(path), { recursive: true });
    temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(normalized.config, null, 2)}\n`, 'utf8');
    renameSync(temporary, path);
  } catch (error) {
    if (temporary !== undefined) {
      try {
        rmSync(temporary, { force: true });
      } catch {
        // Best-effort cleanup.
      }
    }
    return { ok: false, error: `无法写入工具配置：${error instanceof Error ? error.message : String(error)}` };
  }
  try {
    const stat = statSync(path);
    configCache.set(path, {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      result: { config: normalized.config, error: null, exists: true },
    });
  } catch {
    // The next read repopulates the cache.
  }
  return { ok: true, config: normalized.config, path };
}

/**
 * Create the default configuration file when it is absent.
 * @param {Record<string, string | undefined>} [env] - environment mapping.
 * @returns {{ created: boolean, path: string, error?: string }}
 */
export function ensureConfigFile(env = process.env) {
  const path = resolveConfigPath(env);
  if (existsSync(path)) return { created: false, path };
  const text = `${JSON.stringify(defaultConfig(), null, 2)}\n`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, { encoding: 'utf8', flag: 'wx' });
    return { created: true, path };
  } catch (error) {
    if (error?.code === 'EEXIST') return { created: false, path };
    return {
      created: false,
      path,
      error: `无法创建工具配置：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Validate a settings-page add request and append a new pack.
 * @param {object} config - current normalized configuration.
 * @param {unknown} input - `{ label, tools, guidance? }`.
 * @returns {{ ok: boolean, config?: object, pack?: object, errors: Array<{path: string, message: string}> }}
 */
export function appendToolPack(config, input) {
  const errors = [];
  if (!isPlainObject(input)) {
    return { ok: false, errors: [{ path: '$', message: '请求体必须是对象' }] };
  }
  const label = typeof input.label === 'string' ? input.label.trim() : '';
  if (label === '') errors.push({ path: 'label', message: '菜单名称不能为空' });
  else if (label.length > MAX_LABEL_LENGTH) errors.push({ path: 'label', message: `不能超过 ${MAX_LABEL_LENGTH} 个字符` });
  const guidance = input.guidance === undefined ? '' : input.guidance;
  if (typeof guidance !== 'string') errors.push({ path: 'guidance', message: '提示词必须是字符串' });
  else if (guidance.length > MAX_GUIDANCE_LENGTH) errors.push({ path: 'guidance', message: `不能超过 ${MAX_GUIDANCE_LENGTH} 个字符` });
  if (!Array.isArray(input.tools) || input.tools.length === 0) {
    errors.push({ path: 'tools', message: '至少选择一个工具' });
  }
  const names = [];
  if (Array.isArray(input.tools)) {
    for (const value of input.tools) {
      if (typeof value !== 'string' || value.trim() === '') {
        errors.push({ path: 'tools', message: '每项必须是非空字符串' });
        continue;
      }
      const name = value.trim();
      if (BUILTIN_TOOL_SET.has(name)) {
        errors.push({ path: 'tools', message: `"${name}" 是内置工具，不能配置` });
        continue;
      }
      if (ALWAYS_INJECTED_TOOL_SET.has(name)) {
        errors.push({ path: 'tools', message: `"${name}" 是 Host 始终注入的工具，不能配置` });
        continue;
      }
      if (!names.includes(name)) names.push(name);
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  let id;
  do {
    id = `pack-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  } while (config.tools.some((pack) => pack.id === id));
  const pack = { id, label, icon: 'default', tools: names, guidance };
  const normalized = normalizeConfig({ version: CONFIG_VERSION, tools: [...config.tools, pack] });
  if (!normalized.ok) return { ok: false, errors: normalized.errors };
  return { ok: true, config: normalized.config, pack };
}

/**
 * Apply a settings-page patch to one existing pack.
 *
 * Only the guidance and the hidden flag are editable from the page; the menu
 * name, tools, and icon stay as created (or as edited by hand in the file).
 *
 * @param {object} config - current normalized configuration.
 * @param {string} id - target pack id.
 * @param {{ guidance?: unknown, hidden?: unknown }} patch - supported fields.
 * @returns {{ ok: boolean, config?: object, pack?: object, notFound?: boolean, errors: Array<{path: string, message: string}> }}
 */
export function updateToolPack(config, id, patch) {
  const errors = [];
  const target = config.tools.find((pack) => pack.id === id);
  if (target === undefined) {
    return { ok: false, notFound: true, errors: [{ path: 'id', message: `找不到工具包：${String(id)}` }] };
  }
  if (!isPlainObject(patch)) {
    return { ok: false, errors: [{ path: '$', message: '请求体必须是对象' }] };
  }
  const next = { ...target };
  if (patch.guidance !== undefined) {
    if (typeof patch.guidance !== 'string') {
      errors.push({ path: 'guidance', message: '提示词必须是字符串' });
    } else if (patch.guidance.length > MAX_GUIDANCE_LENGTH) {
      errors.push({ path: 'guidance', message: `不能超过 ${MAX_GUIDANCE_LENGTH} 个字符` });
    } else {
      next.guidance = patch.guidance;
    }
  }
  if (patch.hidden !== undefined) {
    if (typeof patch.hidden !== 'boolean') {
      errors.push({ path: 'hidden', message: 'hidden 必须是布尔值' });
    } else if (patch.hidden) {
      next.hidden = true;
    } else {
      delete next.hidden;
    }
  }
  if (patch.guidance === undefined && patch.hidden === undefined) {
    errors.push({ path: '$', message: '只支持修改 guidance 或 hidden' });
  }
  if (errors.length > 0) return { ok: false, errors };
  const normalized = normalizeConfig({
    version: CONFIG_VERSION,
    tools: config.tools.map((pack) => (pack.id === id ? next : pack)),
  });
  if (!normalized.ok) return { ok: false, errors: normalized.errors };
  const updated = normalized.config.tools.find((pack) => pack.id === id);
  return { ok: true, config: normalized.config, pack: updated };
}
