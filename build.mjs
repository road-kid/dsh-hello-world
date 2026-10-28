/**
 * Build script for dsh-hello-world.
 *
 * The plugin is a bundle: it has no runtime entry of its own. Its two components
 * are separate packages stored under `packages/`, and the loader finds them
 * through `node_modules` entries that this script keeps in place. Each component
 * therefore gets its own manifest, locale metadata, host entry and client bundle,
 * which is how the plugin manager shows one card titled `dsh-hello-world` with
 * `quick-restart` and `quick-terminal` listed underneath it.
 */
import { lstat, mkdir, readFile, rm, symlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const root = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))

/** Modules the Host provides; nothing here is bundled into the plugin. */
const HOST_EXTERNAL = ['@deepseek-ai/cordis', '@deepseek-ai/schemastery', 'node:*']

/** Modules the page provides through its module table. */
const CLIENT_EXTERNAL = ['react', 'react-dom', 'react/jsx-runtime']

/**
 * One component package: where it lives and which sources compile into it.
 * @typedef {{ packageDir: string, name: string, host: string, client: string }} Component
 */

/** @type {Component[]} */
const COMPONENTS = [
  {
    packageDir: 'packages/dsh-quick-restart',
    name: 'dsh-quick-restart',
    host: 'src/index.ts',
    client: 'src/client/index.ts',
  },
  {
    packageDir: 'packages/dsh-quick-terminal',
    name: 'dsh-quick-terminal',
    host: 'src/terminal/entry.ts',
    client: 'src/terminal/client.tsx',
  },
]

/**
 * Compile a host entry to an ES module.
 * @param {string} entry - source file.
 * @param {string} outfile - output file.
 */
async function buildHost(entry, outfile) {
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    sourcemap: true,
    external: HOST_EXTERNAL,
    legalComments: 'none',
    logLevel: 'warning',
    // Chinese dictionary entries belong in the shipped file as characters. The
    // esbuild default escapes them to \uXXXX, which makes every log line and diff
    // about the locale files unreadable.
    charset: 'utf8',
    define: { 'process.env.NODE_ENV': '"production"' },
  })
}

/**
 * Compile a client entry into a page module.
 * @param {string} entry - source file.
 * @param {string} outfile - output file.
 * @param {string} id - loader id; must be the package name.
 */
async function buildClient(entry, outfile, id) {
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    sourcemap: true,
    external: CLIENT_EXTERNAL,
    legalComments: 'none',
    logLevel: 'warning',
    charset: 'utf8',
    define: { 'process.env.NODE_ENV': '"production"' },
    banner: {
      js: [
        `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
        'var module = { exports: {} }; var exports = module.exports;',
      ].join('\n'),
    },
    footer: { js: 'return module.exports; } });' },
  })
}

/**
 * Point `node_modules/<name>` at the component package so the loader resolves it.
 *
 * The link type is platform-specific on purpose: `junction` is a Windows-only
 * directory reparse point, and Node ignores the type everywhere else but records
 * whatever it was given, so a POSIX checkout would claim to carry a Windows link.
 * @param {string} name - package name used by the bundle patch rows.
 * @param {string} packageDir - absolute component directory.
 */
async function linkPackage(name, packageDir) {
  const link = join(root, 'node_modules', name)
  const stat = await lstat(link).catch(() => undefined)
  if (stat !== undefined) {
    if (stat.isSymbolicLink() || stat.isDirectory()) await rm(link, { recursive: true, force: true })
    else await rm(link, { force: true })
  }
  await mkdir(join(root, 'node_modules'), { recursive: true })
  await symlink(packageDir, link, process.platform === 'win32' ? 'junction' : 'dir')
}

async function main() {
  /** @type {[string, string][]} */
  const outputs = []

  // The bundle package resolves like any other plugin, so it keeps a tiny entry.
  await rm(join(root, 'lib'), { recursive: true, force: true })
  await mkdir(join(root, 'lib'), { recursive: true })
  await buildHost(join(root, 'src/bundle.ts'), join(root, 'lib/index.js'))
  outputs.push(['dsh-hello-world bundle', join(root, 'lib/index.js')])

  for (const component of COMPONENTS) {
    const packageDir = join(root, component.packageDir)
    const outDir = join(packageDir, 'lib')
    await rm(outDir, { recursive: true, force: true })
    await mkdir(outDir, { recursive: true })
    await buildHost(join(root, component.host), join(outDir, 'index.js'))
    await buildClient(join(root, component.client), join(outDir, 'client.js'), component.name)
    await linkPackage(component.name, packageDir)
    outputs.push([`${component.name} host`, join(outDir, 'index.js')])
    outputs.push([`${component.name} client`, join(outDir, 'client.js')])
  }

  console.log(`${pkg.name}@${pkg.version} built`)

  for (const [label, file] of outputs) {
    const { size } = await lstat(file)
    console.log(`  ${label.padEnd(34)} ${file.slice(root.length + 1).padEnd(34)} ${size} bytes`)
  }
}

await main()
