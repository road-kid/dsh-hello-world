/**
 * Bundle-resolution verification: prove the Loader can actually reach the
 * components `cordis.patch.yml` inserts.
 *
 * A bundle patch names its rows by bare package specifier, and the Harness
 * resolves those against the profile's package resolution table — built from
 * the dependency closure of every profile layer, anchored at that layer's
 * manifest. A component that merely sits on disk inside this package's
 * `node_modules` is invisible to that table: the row then fails to import with
 * `ERR_MODULE_NOT_FOUND ... imported from <profile dir>`, both halves stay
 * unloaded, and the buttons simply never appear. Declaring the components in
 * this package's `dependencies` is what puts them in the closure.
 *
 * What is verified:
 *
 * 1. the manifest declares `dsh.bundle.patch` and that file parses into exactly
 *    the rows the plugin documents, each with an `id` and a bare `name`;
 * 2. every row name is declared in `dependencies` with a `file:` directory
 *    whose manifest name equals the row name;
 * 3. Node's own lookup — the one the closure walks — resolves each row from
 *    this package's manifest to that directory through `node_modules`;
 * 4. each component carries the `dsh.client` half a web profile loads, the same
 *    export surface, and the source maps its `files` list must ship;
 * 5. one version string is shared by the three manifests and `protocol.ts`,
 *    which is otherwise hand-copied and silently driftable.
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const require = createRequire(join(root, 'package.json'))

const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

/** `barePackageName` as the profile resolver applies it. */
function barePackageName(specifier) {
  const first = specifier.at(0)
  if (first === '.' || first === '/' || first === '\\' || first === '#' || specifier.includes(':')) {
    return undefined
  }
  return specifier
}

// 1. The patch exists and parses into rows that carry both an id and a name.
const patchPath = resolve(root, manifest.dsh?.bundle?.patch ?? '')
assert.ok(manifest.dsh?.bundle?.patch, 'the manifest must declare dsh.bundle.patch')
assert.equal(manifest.dsh?.manifestVersion, 1, 'the bundle manifest must declare dsh.manifestVersion 1')
const patch = readFileSync(patchPath, 'utf8')

/**
 * Rows of the patch, in order. A row is `- id: <row id>` followed by
 * `name: <bare package>`; the dialect is a flat list under `insert`.
 * @type {{ id: string, name?: string }[]}
 */
const rows = []
for (const line of patch.split('\n')) {
  const id = /^\s*-\s*id:\s*(\S+)\s*$/u.exec(line)
  if (id !== null) {
    rows.push({ id: id[1] })
    continue
  }
  const name = /^\s*name:\s*(\S+)\s*$/u.exec(line)
  if (name !== null && rows.length > 0 && rows.at(-1).name === undefined) rows.at(-1).name = name[1]
}

assert.equal(rows.length, 2, 'the patch inserts exactly the two components the README documents')
assert.deepEqual(rows.map(row => row.id), ['quick-restart', 'quick-terminal'], 'row ids are the patch ids the profile edits')
for (const row of rows) {
  assert.match(row.id, /^[a-z][a-z0-9-]*$/u, `row id "${row.id}" must be lower-kebab-case`)
  assert.ok(row.name !== undefined, `row "${row.id}" must name a package`)
  assert.ok(barePackageName(row.name) !== undefined, `row name "${row.name}" must be a bare specifier`)
}
const rowNames = rows.map(row => row.name)
assert.equal(new Set(rowNames).size, rowNames.length, 'row names must be unique')
console.log(`✓ the bundle patch inserts ${rows.length} named row(s): ${rows.map(row => `${row.id}=${row.name}`).join(', ')}`)

// 2. Each row is a declared dependency pointing at its own directory.
/** Resolved component directories, in patch order. */
const componentDirs = rowNames.map((name) => {
  const spec = manifest.dependencies?.[name]
  assert.ok(spec !== undefined, `"${name}" is not declared in dependencies`)
  assert.ok(spec.startsWith('file:'), `"${name}" must be declared as a file: directory, got "${spec}"`)
  const dir = resolve(root, spec.slice('file:'.length))
  const component = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  assert.equal(component.name, name, `${dir}/package.json must be named "${name}"`)
  return dir
})
console.log('✓ every row is a file: dependency whose manifest carries the row name')

// 3. Node resolves the row from this package's manifest to that same directory
//    through the `node_modules` link the build creates.
rowNames.forEach((name, index) => {
  const linkPath = join(root, 'node_modules', name, 'package.json')
  const resolved = require.resolve(`${name}/package.json`)
  // The link is a junction on Windows, so Node reports the target path.
  assert.equal(
    resolve(resolved),
    realpathSync(linkPath),
    `node must resolve "${name}" through ${join(root, 'node_modules')}`,
  )
  assert.equal(
    readFileSync(linkPath, 'utf8'),
    readFileSync(join(componentDirs[index], 'package.json'), 'utf8'),
    `"${name}" must link to ${componentDirs[index]}`,
  )
})
console.log('✓ node lookup reaches every row through its node_modules link from the bundle manifest')

// 4. Each component ships the same browser half and the same published surface.
/** Manifest key set of the first component, so symmetry is provable. */
let surface
for (const [index, name] of rowNames.entries()) {
  const component = JSON.parse(readFileSync(join(componentDirs[index], 'package.json'), 'utf8'))
  assert.equal(component.dsh?.manifestVersion, 1, `"${name}" must declare dsh.manifestVersion 1`)
  assert.equal(component.dsh?.client?.platform, 'web', `"${name}" must declare a web client half`)
  assert.ok(
    component.exports?.['./client'] !== undefined,
    `"${name}" must export ./client for the browser bundle`,
  )
  // The plugin manager reads a component's title and description from its own
  // locale files, so both components must publish the same locale pattern.
  assert.ok(component.exports?.['./locale/*.json'] !== undefined, `"${name}" must publish its locale files`)

  const keys = Object.keys(component.exports ?? {}).sort()
  surface ??= keys
  assert.deepEqual(keys, surface, `"${name}" must publish the same export surface as its sibling`)

  // The build emits a source map beside each artifact; `files` decides whether
  // the published package actually contains them.
  for (const artifact of ['lib/index.js.map', 'lib/client.js.map']) {
    assert.ok(component.files?.includes(artifact), `"${name}" must publish ${artifact}`)
  }
}
console.log('✓ every component ships the web client half, the same export surface and its source maps')

// 5. One version string: the three manifests and the hand-copied protocol constant.
const protocolSource = readFileSync(join(root, 'src/shared/protocol.ts'), 'utf8')
const protocolVersion = /export const PLUGIN_VERSION = '([^']+)'/u.exec(protocolSource)?.[1]
assert.ok(protocolVersion !== undefined, 'protocol.ts must export PLUGIN_VERSION as a string literal')
assert.equal(protocolVersion, manifest.version, 'protocol.ts PLUGIN_VERSION must equal the bundle version')
for (const [index, name] of rowNames.entries()) {
  const component = JSON.parse(readFileSync(join(componentDirs[index], 'package.json'), 'utf8'))
  assert.equal(component.version, manifest.version, `"${name}" must carry the bundle version ${manifest.version}`)
}
console.log(`✓ version ${manifest.version} is shared by the bundle, both components and protocol.ts`)

console.log('\nall bundle-resolution checks passed')
