/**
 * Host-half contract probe for the chat-mode bundle.
 *
 * The Host row itself is intentionally empty; what this bundle promises is its
 * Agent preset declaration and the preset-scope plugin behind it. The probe
 * therefore checks the contract the Loader and the roster depend on: the entry
 * id, the patch shape, the preset identity, and the restricted composition.
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

  const preset = await import(pathToFileURL(join(root, 'preset.js')).href)
  check('preset half exports apply()', typeof preset.apply === 'function')
  check('preset half injects its required services', Array.isArray(preset.inject)
    && ['sessionProjections', 'permissionPresets', 'agents'].every(name => preset.inject.includes(name)), JSON.stringify(preset.inject))

  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  check('exports the preset subpath', manifest.exports?.['./preset'] === './preset.js')
  check('exports the client subpath', manifest.exports?.['./client'] === './client.js')
  check('bundle patch is declared', manifest.dsh?.bundle?.patch === './cordis.patch.yml')
  check('client platform is web', manifest.dsh?.client?.platform === 'web')

  return { identity: mod.ENTRY_ID }
}

runProbe(import.meta.url, probeHost)
