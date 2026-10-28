import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import type { ProfileContextView } from '../shared/protocol.ts'

/**
 * Which installation, and which profile, this Host belongs to.
 *
 * The terminal banner names the product, and the `dsh` shim has to forward to the
 * *installation's own* carrier CLI rather than to whatever `dsh` happens to be on
 * PATH. Both facts come from the packaged layout, so this module owns the only
 * place that reads it — a second copy of "where is the desktop CLI" is how the
 * banner and the shim drift apart.
 *
 * The same layout answers where the running DSH lives (`resolveInstallationRoot`),
 * which is what the banner's `Directory` fact prints: the installation
 * directory of a packaged app, the checkout root of a source run, the package
 * directory of a published install. All three are derived from `process.execPath` and
 * `process.argv`, because a plugin cannot import the Host's own modules.
 *
 * Nothing here throws: a missing or malformed manifest is a normal state for a
 * source checkout, and it degrades to "no installation", not to a failure.
 */

/** The product the running Host belongs to, as the terminal title prints it. */
export interface ProductIdentity {
  /** Product name, e.g. `DeepSeek Harness`. */
  readonly product: string
  /** Product version, when the running code names one. */
  readonly version?: string
}

/** The installation's carrier CLI, when the Host runs from an installation. */
export interface Deployment {
  /** The installation's executable. */
  readonly executable: string
  /** The desktop CLI entry inside the bundled runtime. */
  readonly bootstrap: string
  /** Product name for the title line. */
  readonly product: string
  /** Product version for the title line. */
  readonly version?: string
}

/** Services the terminal needs from the Host. */
export interface TerminalContext {
  get(name: string): unknown
}

/** The official product name, printed by both the app and the CLI. */
export const PRODUCT_NAME = 'DeepSeek Harness'

/** The package whose manifest version is the running CLI's version. */
const CLI_PACKAGE = '@deepseek-ai/dsh'

/** The packaged application's package name, used by the desktop install. */
const DESKTOP_PACKAGE = '@deepseek-ai/dsh-desktop'

/** The workspace file that marks the root of a DSH source checkout. */
const CHECKOUT_MARKER = 'pnpm-workspace.yaml'

/** The monorepo root's own package name: the second marker of a source checkout. */
const CHECKOUT_PACKAGE = '@deepseek-ai/dsh-root'

/** How many directories the manifest walk climbs before giving up. */
const MANIFEST_WALK_LIMIT = 8

/** How many directories the bundle walk climbs looking for a macOS `.app`. */
const BUNDLE_WALK_LIMIT = 4

/** The archive a packaged application runs its code from. */
const APP_ARCHIVE = 'app.asar'

/** The directory a packaged application keeps its archive in, at the installation root. */
const RESOURCES = 'resources'

/** The same directory as macOS spells it, inside a `.app` bundle. */
const RESOURCES_BUNDLED = 'Resources'

/** The directory under the DSH home that holds one directory per profile. */
const PROFILES = 'profiles'

/**
 * Locate the installation whose terminal behaviour this plugin reproduces.
 *
 * The check is the packaged layout alone — `<app>/resources/app.asar` next to the
 * executable, with a resources manifest that names the desktop product. It is
 * deliberately platform-neutral: a packaged install has the same layout on Linux,
 * where the promised POSIX `dsh` shim would otherwise silently never be written.
 * A source checkout (`dsh web` from a working copy) has no such directory on any
 * platform, so it correctly reports "no installation" and the terminal opens with
 * the user's own `dsh`.
 *
 * @param executable - the Host's executable.
 * @returns the carrier description, or `undefined` outside an installation.
 */
export function resolveDeployment(executable: string = process.execPath): Deployment | undefined {
  const resources = join(dirname(executable), 'resources')
  if (!existsSync(join(resources, 'app.asar'))) return undefined
  const manifest = readManifest(join(resources, 'package.json'))
  // Another Electron app can ship a `resources/app.asar` too; only the desktop
  // product's manifest proves that the carrier CLI this shim calls is there.
  if (manifest?.name !== DESKTOP_PACKAGE) return undefined
  return {
    executable,
    bootstrap: join(resources, 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js'),
    product: PRODUCT_NAME,
    version: manifest.version,
  }
}

/** Read a package manifest, tolerating a missing or malformed file. */
function readManifest(file: string): { name?: string; version?: string } | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const { name, version } = parsed as { name?: unknown; version?: unknown }
    return {
      name: typeof name === 'string' ? name : undefined,
      version: typeof version === 'string' ? version : undefined,
    }
  } catch {
    return undefined
  }
}

/**
 * Resolve the product identity the terminal title prints.
 *
 * Two ways of running the Host exist. A packaged install carries the product
 * manifest next to the executable (see `resolveDeployment`), which names both the
 * product and its version. A source checkout — the Web GUI started with `dsh web`
 * — has no such manifest, so the version comes from the running CLI package
 * instead: the nearest `@deepseek-ai/dsh` manifest above the script Node was
 * started with (`argv[1]`, the CLI's `lib/bin.js`). Both paths print the same
 * title, which is the point: the Web terminal must not degrade to a bare `DSH`
 * while the desktop app names itself.
 *
 * @param executable - the Host's executable.
 * @param argv - the Host's arguments; `argv[1]` is the CLI entry when running
 *   from a source checkout.
 * @returns the identity, or `undefined` when neither path names a product.
 */
export function resolveIdentity(
  executable: string = process.execPath,
  argv: readonly string[] = process.argv,
): ProductIdentity | undefined {
  const deployment = resolveDeployment(executable)
  if (deployment !== undefined) return { product: deployment.product, version: deployment.version }
  const cli = cliPackage(argv[1])
  if (cli === undefined) return undefined
  return { product: PRODUCT_NAME, version: cli.manifest.version }
}

/**
 * Resolve the root of the DSH this Host runs from: the banner's `Directory` fact.
 *
 * This is the answer to "where does the DSH I am using live", not "where did the
 * terminal open": a packaged install answers with its installation directory, a
 * source checkout (`dsh web` from a working copy) with the checkout root, and a
 * published install with the `@deepseek-ai/dsh` package directory. The directory
 * the shell starts in is a different question and is resolved by
 * `terminalDirectory`.
 *
 * A packaged install is recognised by the archive next to its executable rather
 * than by a manifest (see `packagedRoot`), because a desktop build can ship without
 * `resources/package.json`; that is also why this function no longer goes through
 * `resolveDeployment`.
 *
 * @param executable - the Host's executable.
 * @param argv - the Host's arguments; `argv[1]` is the CLI entry when running
 *   from a source checkout.
 * @returns the root, or `undefined` when nothing names one.
 */
export function resolveInstallationRoot(
  executable: string = process.execPath,
  argv: readonly string[] = process.argv,
): string | undefined {
  const packaged = packagedRoot(executable)
  if (packaged !== undefined) return packaged
  const cli = cliPackage(argv[1])
  if (cli === undefined) return undefined
  return checkoutRoot(cli.directory)
}

/**
 * The installation directory of a packaged application.
 *
 * A packaged app keeps its code in a `resources/app.asar` archive next to the
 * executable: on Windows and Linux the executable sits at the installation root, so
 * the archive is one level down, and inside a macOS bundle both sit deeper, under
 * `Contents`, where the bundle itself is the installation. The archive is the marker
 * rather than a manifest, because a desktop build can ship without a
 * `resources/package.json` — the question here is only where the app is installed.
 *
 * @param executable - the Host's executable.
 * @returns the installation directory, or `undefined` outside a packaged app.
 */
function packagedRoot(executable: string): string | undefined {
  let directory = dirname(executable)
  for (let depth = 0; depth < BUNDLE_WALK_LIMIT; depth += 1) {
    if (holdsArchive(directory)) return bundleRoot(directory)
    const parent = dirname(directory)
    if (parent === directory) return undefined
    directory = parent
  }
  return undefined
}

/** Whether a directory holds a packaged application's archive. */
function holdsArchive(directory: string): boolean {
  for (const name of [RESOURCES, RESOURCES_BUNDLED]) {
    if (existsSync(join(directory, name, APP_ARCHIVE))) return true
  }
  return false
}

/**
 * The bundle a packaged application lives in.
 *
 * On macOS the installation a user names is the `.app` bundle, not the `Contents`
 * directory the executable sits in, so the walk climbs to the bundle when the
 * directory is inside one.
 *
 * @param directory - the directory that holds the application's archive.
 * @returns the `.app` bundle, or the directory itself elsewhere.
 */
function bundleRoot(directory: string): string {
  let current = directory
  for (let depth = 0; depth < BUNDLE_WALK_LIMIT; depth += 1) {
    if (current.endsWith('.app')) return current
    const parent = dirname(current)
    if (parent === current) return directory
    current = parent
  }
  return directory
}

/**
 * The checkout root above a CLI package.
 *
 * A source checkout is a workspace: the CLI package lives under `apps/cli` and the
 * root above it carries the workspace file and the `@deepseek-ai/dsh-root` manifest.
 * A published install has neither, so the package directory itself is the
 * installation and the walk falls back to it.
 *
 * @param start - the CLI package directory found by `cliPackage`.
 * @returns the outermost directory that still belongs to the product.
 */
function checkoutRoot(start: string): string {
  let directory = start
  for (let depth = 0; depth < MANIFEST_WALK_LIMIT; depth += 1) {
    if (existsSync(join(directory, CHECKOUT_MARKER))) return directory
    if (readManifest(join(directory, 'package.json'))?.name === CHECKOUT_PACKAGE) return directory
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  return start
}

/**
 * Find the CLI package above the script Node was started with.
 *
 * The walk stops at the nearest manifest that names the CLI (or the packaged
 * desktop app); any other manifest on the way belongs to a wrapper, not to the
 * product, so it is skipped. The directory comes back with the manifest because
 * the installation root is resolved from where the package sits, not from what it
 * declares.
 *
 * @param script - `argv[1]`: the script the Host process runs.
 * @returns that package's directory and manifest, or `undefined` when the walk
 *   finds none.
 */
function cliPackage(
  script: string | undefined,
): { readonly directory: string; readonly manifest: { name?: string; version?: string } } | undefined {
  if (typeof script !== 'string' || script.length === 0) return undefined
  let directory = dirname(script)
  for (let depth = 0; depth < MANIFEST_WALK_LIMIT; depth += 1) {
    const manifest = readManifest(join(directory, 'package.json'))
    if (manifest?.name === CLI_PACKAGE || manifest?.name === DESKTOP_PACKAGE) return { directory, manifest }
    const parent = dirname(directory)
    if (parent === directory) return undefined
    directory = parent
  }
  return undefined
}

/**
 * Resolve the profile directory the terminal opens in.
 *
 * The host `profileContext` service knows it; the process environment carries it
 * as a fallback for load orders where the service is not bound yet.
 * @param ctx - host context.
 * @param environment - the process environment.
 * @param cwd - the Host's working directory, the last resort.
 * @returns the first existing candidate.
 */
export function terminalDirectory(
  ctx: TerminalContext,
  environment: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): string {
  const candidates = [profileContext(ctx)?.dir, environment.DSH_PROFILE_DIR].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  )
  const home = environment.DSH_HOME
  if (home !== undefined && home.length > 0) {
    candidates.push(join(home, PROFILES, terminalProfile(ctx, environment)))
  }
  candidates.push(cwd)
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return cwd
}

/**
 * Resolve the profile name the terminal's `dsh` edits.
 *
 * @param ctx - host context.
 * @param environment - the process environment.
 * @returns the profile name; `default` when nothing publishes one.
 */
export function terminalProfile(ctx: TerminalContext, environment: NodeJS.ProcessEnv = process.env): string {
  const name = profileContext(ctx)?.name ?? environment.DSH_PROFILE
  return typeof name === 'string' && name.length > 0 ? name : 'default'
}

/** The host `profileContext` service, when it is bound. */
function profileContext(ctx: TerminalContext): ProfileContextView | undefined {
  try {
    const value = ctx.get('profileContext')
    if (typeof value === 'object' && value !== null) return value as ProfileContextView
  } catch {
    // Not bound in this load order.
  }
  return undefined
}

/** `DSH_HOME`, when the Host publishes one. */
export function terminalHome(environment: NodeJS.ProcessEnv): string | undefined {
  const home = environment.DSH_HOME
  return typeof home === 'string' && home.length > 0 ? home : undefined
}

/**
 * The DSH home a profile directory belongs to, read off the directory itself.
 *
 * A profile directory is `<DSH home>/profiles/<name>`, so the home is its second
 * parent — but only when the middle segment really is `profiles`. That check is
 * what keeps this from inventing a home for a directory that merely happens to be
 * two levels deep, such as the Host's working directory used as a last resort.
 *
 * @param profileDirectory - the directory the terminal opens in.
 * @returns the home, or `undefined` when the directory is not a profile directory.
 */
export function homeOfProfile(profileDirectory: string): string | undefined {
  const profiles = dirname(profileDirectory)
  if (basename(profiles) !== PROFILES) return undefined
  const home = dirname(profiles)
  return home === profiles ? undefined : home
}
