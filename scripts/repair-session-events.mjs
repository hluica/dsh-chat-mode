#!/usr/bin/env node
/**
 * Repair session logs written by dsh-chat-mode 1.2.0.
 *
 * 1.2.0 appended two plugin-defined event types with `Session.append()`:
 * `chat-mode/tools` and `chat-mode/availability`. `Session.append()` cannot set
 * the envelope's `ignorable: true` marker, so the persistence reader refuses to
 * interpret such a log after a restart:
 *
 *   contains event type "chat-mode/availability" (seq 7) unknown to this
 *   harness and not marked ignorable; refusing to interpret the log
 *
 * 1.2.1 stops writing those events (the /chat-tools choice is reconstructed
 * from the known command/run + command/done pair, and availability comes from
 * the Host route). This script repairs existing logs by adding
 * `"ignorable": true` to those two legacy event types in place, after writing
 * a timestamped backup next to the original. The events are then retained but
 * skipped by readers that do not know them.
 *
 * Usage:
 *   node scripts/repair-session-events.mjs [--write] <session.v4.jsonl.zstd>...
 *
 * Without --write the script only reports how many events would change.
 *
 * @module scripts/repair-session-events
 */
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

/** Legacy event types written by 1.2.0. */
const LEGACY_TYPES = new Set(['chat-mode/tools', 'chat-mode/availability']);

/** Generous stdout budget for a large JSONL session log. */
const MAX_BUFFER = 512 * 1024 * 1024;

/**
 * Run the zstd CLI and return its stdout buffer.
 * @param args - arguments after the executable.
 * @param input - optional stdin bytes.
 * @returns stdout bytes.
 * @throws when zstd is missing or exits non-zero.
 */
function zstd(args, input) {
  const result = spawnSync('zstd', args, {
    input,
    maxBuffer: MAX_BUFFER,
    encoding: null,
  });
  if (result.error !== undefined) throw new Error(`zstd: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`zstd ${args.join(' ')} failed: ${String(result.stderr)}`);
  }
  return result.stdout;
}

/**
 * Parse one decompressed JSONL buffer into events.
 * @param raw - entire JSONL text.
 * @returns events and whether the file ended with a newline.
 */
function parseLog(raw) {
  const endedWithNewline = raw.endsWith('\n');
  const lines = raw.split('\n');
  if (endedWithNewline) lines.pop();
  const events = [];
  for (const [index, line] of lines.entries()) {
    if (line === '') continue;
    try {
      events.push(JSON.parse(line));
    } catch (error) {
      throw new Error(`line ${index + 1} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { events, endedWithNewline };
}

/**
 * Add `ignorable: true` to every legacy event that lacks it.
 * @param events - parsed session events.
 * @returns the count changed; mutates the event objects.
 */
function markIgnorable(events) {
  let changed = 0;
  for (const event of events) {
    if (!LEGACY_TYPES.has(event.type)) continue;
    if (event.ignorable === true) continue;
    event.ignorable = true;
    changed += 1;
  }
  return changed;
}

/**
 * Verify a repaired buffer still parses and every legacy event is ignorable.
 * @param raw - rewritten JSONL text.
 * @returns the number of legacy events found.
 */
function validate(raw) {
  const { events } = parseLog(raw);
  let legacy = 0;
  for (const event of events) {
    if (!LEGACY_TYPES.has(event.type)) continue;
    legacy += 1;
    if (event.ignorable !== true) throw new Error(`legacy event ${event.type} at seq ${String(event.seq)} is still not ignorable`);
  }
  return legacy;
}

/**
 * Repair one session log.
 * @param file - absolute or relative path to session.v4.jsonl.zstd.
 * @param write - whether to replace the file.
 * @returns a short human-readable result.
 */
function repairFile(file, write) {
  if (!file.endsWith('.zstd')) throw new Error(`${file}: expected a .zstd session log`);
  if (!existsSync(file)) throw new Error(`${file}: not found`);
  const raw = zstd(['-dc', file]).toString('utf8');
  const { events, endedWithNewline } = parseLog(raw);
  const changed = markIgnorable(events);
  if (changed === 0) return `${basename(file)}: no legacy events to repair`;
  if (!write) return `${basename(file)}: ${changed} legacy event(s) would be marked ignorable`;

  const text = `${events.map(event => JSON.stringify(event)).join('\n')}${endedWithNewline ? '\n' : ''}`;
  validate(text);
  const compressed = zstd(['-q', '-19', '-c'], Buffer.from(text, 'utf8'));

  const stamp = new Date().toISOString().replace(/[:.]/gu, '-');
  const backup = `${file}.bak-${stamp}`;
  copyFileSync(file, backup);
  const mode = statSync(file).mode & 0o777;
  const temp = join(dirname(file), `.repair-${basename(file)}.${process.pid}.tmp`);
  writeFileSync(temp, compressed, { mode });
  chmodSync(temp, mode);
  renameSync(temp, file);

  const verified = validate(zstd(['-dc', file]).toString('utf8'));
  return `${basename(file)}: marked ${changed} legacy event(s) ignorable; backup ${basename(backup)}; verified ${verified} legacy record(s)`;
}

/** Parse argv, repair every supplied file, and print one line per file. */
function main() {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const files = args.filter(argument => argument !== '--write');
  if (files.length === 0) {
    console.error('usage: node scripts/repair-session-events.mjs [--write] <session.v4.jsonl.zstd>...');
    process.exitCode = 2;
    return;
  }
  for (const file of files) {
    try {
      console.log(repairFile(file, write));
    } catch (error) {
      console.error(`repair-session-events: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  }
}

main();
