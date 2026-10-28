#!/usr/bin/env node
/**
 * Keep the version in one place.
 *
 * The root package.json is the single source of truth. This script copies that
 * version into the two component manifests and the shared protocol constant, so
 * a release bumps one number and the plugin manager, the runtime status payload
 * and the bundle verifier all report the same version.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

/**
 * Read and parse a JSON file.
 *
 * @param {string} path - absolute path.
 * @returns {Record<string, unknown>}
 */
function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/**
 * Write a JSON file with the repository's two-space, trailing-newline style.
 *
 * @param {string} path - absolute path.
 * @param {Record<string, unknown>} value - object to serialize.
 */
function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

const version = readJson(join(root, 'package.json')).version
if (typeof version !== 'string' || version === '') {
  throw new Error('sync-version: root package.json has no version')
}

for (const name of ['dsh-quick-restart', 'dsh-quick-terminal']) {
  const path = join(root, 'packages', name, 'package.json')
  const manifest = readJson(path)
  if (manifest.version !== version) {
    manifest.version = version
    writeJson(path, manifest)
  }
}

const protocolPath = join(root, 'src', 'shared', 'protocol.ts')
const protocol = readFileSync(protocolPath, 'utf8')
const pattern = /(export const PLUGIN_VERSION = ')[^']*(')/
if (!pattern.test(protocol)) {
  throw new Error('sync-version: PLUGIN_VERSION not found in src/shared/protocol.ts')
}
const next = protocol.replace(pattern, `$1${version}$2`)
if (next !== protocol) writeFileSync(protocolPath, next, 'utf8')

process.stdout.write(`sync-version: ${version}\n`)
