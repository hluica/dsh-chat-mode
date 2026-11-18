/**
 * Host-half contract probe for the chat-mode bundle.
 *
 * The Host row owns the early session-level permission pin; the preset-scope
 * plugin owns the Agent-level permission shadow, tool restrictions, projection,
 * and commands. The probe checks the entry id, the patch shape, the preset
 * identity, the restricted composition, and the early pin's fresh/seeded/switch
 * branches.
 *
 * @module scripts/host-contract
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { runProbe } from './lib/probe-runner.mjs';

/**
 * Assert the Host-half and declaration contract.
 * @param context - `{ root, patchId, check }`.
 * @returns `{ identity }` — the entry id compared against the bundle patch id.
 */
export async function probeHost({ root, patchId, check }) {
  const mod = await import(pathToFileURL(join(root, 'index.js')).href)
  check('exports apply()', typeof mod.apply === 'function')
  check('ENTRY_ID is the bundle patch id', mod.ENTRY_ID === 'dsh-chat-mode', JSON.stringify(mod.ENTRY_ID))
  check('ENTRY_ID matches the supplied patch id', patchId === '' || mod.ENTRY_ID === patchId, `${mod.ENTRY_ID} vs ${patchId}`)
  check('Host half injects permissionPresets', Array.isArray(mod.inject) && mod.inject.includes('permissionPresets'), JSON.stringify(mod.inject))
  check('Host half injects systemPrompt', Array.isArray(mod.inject) && mod.inject.includes('systemPrompt'), JSON.stringify(mod.inject))

  const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
  check('patch inserts the Host row', patch.includes("id: dsh-chat-mode") && patch.includes("@local/dsh-chat-mode"))
  check('patch declares the preset row', patch.includes('id: preset-chat'))
  check('preset id is chat', /id:\s*chat\b/u.test(patch))
  check('preset is order 5', /order:\s*5\b/u.test(patch))
  check('preset mounts the package preset half', patch.includes('@local/dsh-chat-mode/preset'))
  check('restricted file tools are off', patch.includes('write: false') && patch.includes('edit: false') && patch.includes('applyPatch: false'))
  check('read tool is on', patch.includes('read: true'))
  check('web search is registered (then gated)', patch.includes('search: true') && patch.includes('fetch: true'))
  check('tool-result-pruner is mounted', patch.includes('@deepseek-ai/dsh-compaction-tool-result-pruner'))
  check('persona is complete', patch.includes('complete: true'))
  check('persona references the chat tool guidance variable', patch.includes('{{chat_tool_guidance}}'))

  const preset = await import(pathToFileURL(join(root, 'preset.js')).href)
  check('preset half exports apply()', typeof preset.apply === 'function')
  check('preset half injects its required services', Array.isArray(preset.inject)
    && ['sessionProjections', 'permissionPresets', 'agents', 'systemPrompt', 'tools'].every(name => preset.inject.includes(name)), JSON.stringify(preset.inject))

  // Early session-level pin: fresh Chat → read-only; seeded Chat → untouched;
  // switching a blank session to Chat → read-only. The prompt fallback is
  // registered globally so a missing preset half cannot break interpolation.
  const calls = []
  const variables = []
  const handlers = new Map()
  const ctx = {
    permissionPresets: {
      current: () => 'workspace-write',
      set: (session, name) => { calls.push([session, name]) },
    },
    systemPrompt: {
      variable(name, provider) {
        variables.push([name, provider])
        return () => {}
      },
    },
    logger: { warn() {} },
    on(event, handler) {
      handlers.set(event, handler)
      return () => {}
    },
  }
  mod.apply(ctx)
  check('Host half registers the guidance fallback', variables.length === 1 && variables[0][0] === 'chat_tool_guidance', JSON.stringify(variables.map(([name]) => name)))
  check('the guidance fallback is empty', variables[0][1]() === '', JSON.stringify(variables[0][1]()))
  check('Host half listens for session/created', typeof handlers.get('session/created') === 'function')
  check('Host half listens for session/event', typeof handlers.get('session/event') === 'function')
  const flush = () => new Promise(resolve => queueMicrotask(resolve))
  const fresh = { header: { agentPreset: 'chat', isSeeded: false } }
  handlers.get('session/created')(fresh)
  await flush()
  check('fresh chat session is pinned read-only', calls.length === 1 && calls[0][1] === 'read-only', JSON.stringify(calls))
  calls.length = 0
  const seeded = { header: { agentPreset: 'chat', isSeeded: true } }
  handlers.get('session/created')(seeded)
  await flush()
  check('seeded chat session is not repinned', calls.length === 0, JSON.stringify(calls))
  calls.length = 0
  const switched = { header: { agentPreset: 'ptc', isSeeded: false } }
  handlers.get('session/event')(switched, { type: 'agent-preset/selected', data: { agentPreset: 'chat' } })
  await flush()
  check('a blank session switched to chat is pinned read-only', calls.length === 1 && calls[0][1] === 'read-only', JSON.stringify(calls))
  calls.length = 0
  handlers.get('session/event')(fresh, { type: 'agent-preset/selected', data: { agentPreset: 'standard' } })
  await flush()
  check('a non-chat selection is not pinned', calls.length === 0, JSON.stringify(calls))

  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  check('exports the preset subpath', manifest.exports?.['./preset'] === './preset.js')
  check('exports the client subpath', manifest.exports?.['./client'] === './client.js')
  check('bundle patch is declared', manifest.dsh?.bundle?.patch === './cordis.patch.yml')
  check('client platform is web', manifest.dsh?.client?.platform === 'web')

  return { identity: mod.ENTRY_ID }
}

runProbe(import.meta.url, probeHost)
