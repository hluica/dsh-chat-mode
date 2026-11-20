/**
 * Host-half contract probe for the chat-mode bundle.
 *
 * The Host row owns the early session-level permission pin, the prompt
 * fallback, the owner-only tools API, and the `$DSH_HOME` configuration file.
 * The preset-scope plugin owns the Agent-level permission shadow, tool
 * restrictions, projection, and commands. The probe checks the entry id, the
 * patch shape, the preset identity, the restricted composition, the API
 * (state/tools/candidates/POST/PATCH), and the early pin's fresh/seeded/switch
 * branches.
 *
 * It redirects `DSH_HOME` to a temporary directory before importing the Host
 * half, so it never reads or writes the user's real configuration file.
 *
 * @module scripts/host-contract
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';

import { runProbe } from './lib/probe-runner.mjs';

/**
 * Assert the Host-half and declaration contract.
 * @param context - `{ root, patchId, check }`.
 * @returns `{ identity }` — the entry id compared against the bundle patch id.
 */
export async function probeHost({ root, patchId, check }) {
  const previousHome = process.env.DSH_HOME;
  const testHome = mkdtempSync(join(tmpdir(), 'dsh-chat-mode-probe-'));
  process.env.DSH_HOME = testHome;

  try {
    const mod = await import(pathToFileURL(join(root, 'index.js')).href);
    const config = await import(pathToFileURL(join(root, 'config.js')).href);

    check('exports apply()', typeof mod.apply === 'function');
    check('ENTRY_ID is the bundle patch id', mod.ENTRY_ID === 'dsh-chat-mode', JSON.stringify(mod.ENTRY_ID));
    check('ENTRY_ID matches the supplied patch id', patchId === '' || mod.ENTRY_ID === patchId, `${mod.ENTRY_ID} vs ${patchId}`);
    check('Host half injects permissionPresets', Array.isArray(mod.inject) && mod.inject.includes('permissionPresets'), JSON.stringify(mod.inject));
    check('Host half injects systemPrompt', Array.isArray(mod.inject) && mod.inject.includes('systemPrompt'), JSON.stringify(mod.inject));

    const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8');
    check('patch inserts the Host row', patch.includes('id: dsh-chat-mode') && patch.includes('@local/dsh-chat-mode'));
    check('patch declares the preset row', patch.includes('id: preset-chat'));
    check('preset id is chat', /id:\s*chat\b/u.test(patch));
    check('preset is order 5', /order:\s*5\b/u.test(patch));
    check('preset mounts the package preset half', patch.includes('@local/dsh-chat-mode/preset'));
    check('restricted file tools are off', patch.includes('write: false') && patch.includes('edit: false') && patch.includes('applyPatch: false'));
    check('read tool is on', patch.includes('read: true'));
    check('web search is registered (then gated)', patch.includes('search: true') && patch.includes('fetch: true'));
    check('tool-result-pruner is mounted', patch.includes('@deepseek-ai/dsh-compaction-tool-result-pruner'));
    check('persona is complete', patch.includes('complete: true'));
    check('persona references the chat tool guidance variable', patch.includes('{{chat_tool_guidance}}'));

    const preset = await import(pathToFileURL(join(root, 'preset.js')).href);
    check('preset half exports apply()', typeof preset.apply === 'function');
    check('preset half injects its required services', Array.isArray(preset.inject)
      && ['sessionProjections', 'permissionPresets', 'agents', 'systemPrompt', 'tools'].every(name => preset.inject.includes(name)), JSON.stringify(preset.inject));

    // ---- Host context and tools API mocks ---------------------------------

    const calls = [];
    const variables = [];
    const handlers = new Map();
    const routes = [];
    const emitted = [];
    const definitions = [
      { name: 'bash' },
      { name: 'mcp__WolframLanguage__WolframLanguageEvaluator', description: 'Evaluate Wolfram Language.' },
      { name: 'working_directory', description: 'Show or change the working directory.' },
    ];
    const apiCtx = {
      webServer: {
        register(route) {
          routes.push(route);
          return () => {};
        },
      },
      connection: {
        admit: () => ({ peer: { principal: { kind: 'owner' } } }),
      },
      tools: {
        definitions: () => definitions,
      },
      emit(name) {
        emitted.push(name);
      },
      effect(callback) {
        const cleanup = callback();
        return () => { cleanup?.(); };
      },
    };
    const ctx = {
      permissionPresets: {
        current: () => 'workspace-write',
        set: (session, name) => { calls.push([session, name]); },
      },
      systemPrompt: {
        variable(name, provider) {
          variables.push([name, provider]);
          return () => {};
        },
      },
      logger: { warn() {} },
      on(event, handler) {
        handlers.set(event, handler);
        return () => {};
      },
      inject(deps, callback) {
        if (deps.join(',') !== 'webServer,connection,tools') throw new Error(`unexpected inject deps: ${deps}`);
        callback(apiCtx);
        return () => {};
      },
    };
    mod.apply(ctx);

    check('Host half materializes the default configuration file', existsSync(config.resolveConfigPath()), config.resolveConfigPath());
    check('Host half registers the guidance fallback', variables.length === 1 && variables[0][0] === 'chat_tool_guidance', JSON.stringify(variables.map(([name]) => name)));
    check('the guidance fallback is empty', variables[0][1]() === '', JSON.stringify(variables[0][1]()));
    check('Host half listens for session/created', typeof handlers.get('session/created') === 'function');
    check('Host half listens for session/event', typeof handlers.get('session/event') === 'function');
    check('Host half registers the tools route', routes.length === 1
      && routes[0].kind === 'prefix' && routes[0].path === '/dsh-chat-mode/api'
      && typeof routes[0].handler === 'function', JSON.stringify(routes.map(route => ({ kind: route.kind, path: route.path }))));

    const route = routes[0];
    const response = () => {
      const res = {
        statusCode: 0,
        headers: {},
        body: '',
        setHeader(name, value) { this.headers[name] = value; },
        end(body) { this.body = body; },
      };
      return res;
    };
    const request = async (url, method = 'GET', body) => {
      const req = body === undefined
        ? { method, url }
        : Object.assign(Readable.from([Buffer.from(JSON.stringify(body), 'utf8')]), { method, url });
      const res = response();
      await route.handler(req, res);
      return res;
    };
    const payload = (res) => JSON.parse(res.body);

    // ---- state ------------------------------------------------------------

    const state = await request('/dsh-chat-mode/api/state');
    const statePayload = payload(state);
    check('state route returns the Wolfram flag', state.statusCode === 200
      && statePayload.ok === true
      && statePayload.result.wolfram === true, state.body);
    check('state route returns the default custom pack', statePayload.result.custom?.length === 1
      && statePayload.result.custom[0].id === 'wolfram'
      && statePayload.result.custom[0].available === true
      && statePayload.result.custom[0].icon === 'wolfram', state.body);
    check('state route reports the configuration path', typeof statePayload.result.configPath === 'string'
      && statePayload.result.configPath.endsWith('tools.json'), state.body);

    const missingState = await (async () => {
      const saved = definitions.splice(0, definitions.length);
      definitions.push({ name: 'bash' });
      const res = await request('/dsh-chat-mode/api/state');
      definitions.splice(0, definitions.length, ...saved);
      return res;
    })();
    check('state route reports Wolfram absent', payload(missingState).result.wolfram === false, missingState.body);

    // ---- tools configuration ---------------------------------------------

    const tools = await request('/dsh-chat-mode/api/tools');
    const toolsPayload = payload(tools);
    check('tools route returns the default configuration', tools.statusCode === 200
      && toolsPayload.ok === true
      && toolsPayload.result.exists === true
      && toolsPayload.result.config.tools.length === 1
      && toolsPayload.result.config.tools[0].id === 'wolfram', tools.body);
    check('tools route reports the display path', toolsPayload.result.path.startsWith('$DSH_HOME')
      || toolsPayload.result.path.startsWith('~/.dsh'), tools.body);

    // ---- candidates -------------------------------------------------------

    const candidates = await request('/dsh-chat-mode/api/candidates');
    const candidatePayload = payload(candidates);
    const candidateNames = candidatePayload.result.tools.map(tool => tool.name);
    check('candidates exclude built-in tools', !candidateNames.includes('bash') && !candidateNames.includes('read'), candidates.body);
    check('candidates mark configured Wolfram tools', candidatePayload.result.tools
      .find(tool => tool.name.startsWith('mcp__WolframLanguage__'))?.configured === true, candidates.body);
    check('candidates include host-level tools', candidateNames.includes('working_directory'), candidates.body);
    check('candidates mark configured tools', candidatePayload.result.tools
      .find(tool => tool.name === 'working_directory')?.configured === false, candidates.body);

    // ---- POST a new pack -------------------------------------------------

    emitted.length = 0;
    const added = await request('/dsh-chat-mode/api/tools', 'POST', {
      label: '工作目录',
      tools: ['working_directory'],
      guidance: '工作目录工具：仅在用户要求时使用。',
    });
    const addedPayload = payload(added);
    check('POST tools appends a pack', added.statusCode === 200
      && addedPayload.ok === true
      && addedPayload.result.config.tools.length === 2, added.body);
    const addedPack = addedPayload.result.config.tools[1];
    check('POST tools generates a default-icon pack', addedPack.label === '工作目录'
      && addedPack.icon === 'default'
      && addedPack.guidance === '工作目录工具：仅在用户要求时使用。'
      && Array.isArray(addedPack.tools)
      && addedPack.tools.includes('working_directory'), added.body);
    check('POST tools emits the configuration-change event', emitted.includes('chat-mode/config-changed'), JSON.stringify(emitted));

    const stateAfterAdd = payload(await request('/dsh-chat-mode/api/state'));
    check('new pack is visible to the composer', stateAfterAdd.result.custom.some(pack => pack.id === addedPack.id && pack.available === true && pack.hidden === false), JSON.stringify(stateAfterAdd.result.custom));
    const candidatesAfterAdd = payload(await request('/dsh-chat-mode/api/candidates'));
    check('new pack marks its tool configured', candidatesAfterAdd.result.tools
      .find(tool => tool.name === 'working_directory')?.configured === true, JSON.stringify(candidatesAfterAdd.result.tools));

    // ---- PATCH guidance and hidden ---------------------------------------

    emitted.length = 0;
    const guidance = await request('/dsh-chat-mode/api/tools', 'PATCH', {
      id: 'wolfram',
      guidance: '自定义 Wolfram 指引',
    });
    check('PATCH tools updates guidance', guidance.statusCode === 200
      && payload(guidance).result.config.tools.find(pack => pack.id === 'wolfram').guidance === '自定义 Wolfram 指引', guidance.body);
    check('PATCH guidance emits the configuration-change event', emitted.includes('chat-mode/config-changed'), JSON.stringify(emitted));

    const hidden = await request('/dsh-chat-mode/api/tools', 'PATCH', {
      id: 'wolfram',
      hidden: true,
    });
    check('PATCH tools hides a pack', hidden.statusCode === 200
      && payload(hidden).result.config.tools.find(pack => pack.id === 'wolfram').hidden === true, hidden.body);
    const stateAfterHide = payload(await request('/dsh-chat-mode/api/state'));
    check('hidden packs leave the composer menu', !stateAfterHide.result.custom.some(pack => pack.id === 'wolfram'), JSON.stringify(stateAfterHide.result.custom));

    const shown = await request('/dsh-chat-mode/api/tools', 'PATCH', {
      id: 'wolfram',
      hidden: false,
    });
    check('PATCH tools shows a pack again', shown.statusCode === 200
      && payload(shown).result.config.tools.find(pack => pack.id === 'wolfram').hidden !== true, shown.body);

    const missing = await request('/dsh-chat-mode/api/tools', 'PATCH', {
      id: 'pack-missing',
      hidden: true,
    });
    check('PATCH tools reports an unknown pack', missing.statusCode === 404, String(missing.statusCode));

    const invalidPatch = await request('/dsh-chat-mode/api/tools', 'PATCH', {
      id: 'wolfram',
      hidden: 'yes',
    });
    check('PATCH tools rejects a non-boolean hidden', invalidPatch.statusCode === 400, String(invalidPatch.statusCode));

    const builtinAdd = await request('/dsh-chat-mode/api/tools', 'POST', {
      label: '内置工具',
      tools: ['read'],
    });
    check('POST tools rejects a built-in tool', builtinAdd.statusCode === 400, String(builtinAdd.statusCode));

    // ---- routing and authorization ---------------------------------------

    const unauthorized = await (async () => {
      apiCtx.connection.admit = () => ({ rejection: 401 });
      const res = await request('/dsh-chat-mode/api/state');
      apiCtx.connection.admit = () => ({ peer: { principal: { kind: 'owner' } } });
      return res;
    })();
    check('tools route refuses a non-owner', unauthorized.statusCode === 401, String(unauthorized.statusCode));

    const wrongPath = await request('/dsh-chat-mode/api/other');
    check('tools route rejects an unknown path', wrongPath.statusCode === 404, String(wrongPath.statusCode));

    const wrongMethod = await request('/dsh-chat-mode/api/tools', 'DELETE');
    check('tools route rejects an unsupported method', wrongMethod.statusCode === 405, String(wrongMethod.statusCode));

    // ---- early permission pin --------------------------------------------

    const flush = () => new Promise(resolve => queueMicrotask(resolve));
    const fresh = { header: { agentPreset: 'chat', isSeeded: false } };
    handlers.get('session/created')(fresh);
    await flush();
    check('fresh chat session is pinned read-only', calls.length === 1 && calls[0][1] === 'read-only', JSON.stringify(calls));
    calls.length = 0;
    const seeded = { header: { agentPreset: 'chat', isSeeded: true } };
    handlers.get('session/created')(seeded);
    await flush();
    check('seeded chat session is not repinned', calls.length === 0, JSON.stringify(calls));
    calls.length = 0;
    const switched = { header: { agentPreset: 'ptc', isSeeded: false } };
    handlers.get('session/event')(switched, { type: 'agent-preset/selected', data: { agentPreset: 'chat' } });
    await flush();
    check('a blank session switched to chat is pinned read-only', calls.length === 1 && calls[0][1] === 'read-only', JSON.stringify(calls));
    calls.length = 0;
    handlers.get('session/event')(fresh, { type: 'agent-preset/selected', data: { agentPreset: 'standard' } });
    await flush();
    check('a non-chat selection is not pinned', calls.length === 0, JSON.stringify(calls));

    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    check('exports the preset subpath', manifest.exports?.['./preset'] === './preset.js');
    check('exports the client subpath', manifest.exports?.['./client'] === './client.js');
    check('bundle patch is declared', manifest.dsh?.bundle?.patch === './cordis.patch.yml');
    check('client platform is web', manifest.dsh?.client?.platform === 'web');
    check('config.js is packaged', Array.isArray(manifest.files) && manifest.files.includes('config.js'), JSON.stringify(manifest.files));

    return { identity: mod.ENTRY_ID };
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    try {
      rmSync(testHome, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup.
    }
  }
}

runProbe(import.meta.url, probeHost);
