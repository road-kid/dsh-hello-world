/**
 * Client-half verification: load the BUILT `lib/client.js` the way the Harness
 * module loader does and prove what `apply` registers (and disposes).
 *
 * The browser artifact is a lazy factory registered into
 * `window.__ModuleLoader__`, so this script installs that one global, captures
 * the factory, and hands it a stub module table that resolves only the browser
 * modules the host keeps external. A tiny DOM stand-in — just enough for the
 * stylesheet installer — stands in for `document`, since nothing here exercises
 * layout, and rendering React would need the host's own renderer.
 *
 * What is verified:
 *
 * 1. loading the factory has no side effects: nothing is added to the page until
 *    `apply` runs;
 * 2. the factory id equals the package name, and it exports `inject`/`apply`
 *    plus the informational `name`;
 * 3. `inject` names only services the host provides, and the artifact requires
 *    only modules the host module table keeps external (`react`, `react-dom`
 *    and the JSX runtime);
 * 4. `apply` seats the controller in `settings.action` — the official header
 *    slot it shares with the terminal — through `slots.inject` + `slots.register`,
 *    right of the terminal (order 110 > 100) and before the pane's Close;
 * 5. every resource is installed inside `ctx.effect` under one plugin prefix,
 *    and every teardown removes what it added — no `<style>` survives an unload;
 * 6. there is one shared stylesheet: both bundles install the same sheet, it is
 *    counted on the document so the first bundle to unload does not strip the
 *    sheet the other still renders with, and it carries no account-menu rules
 *    because nothing renders a menu row any more;
 * 7. the old account-menu DOM seam is gone: no `attach.ts`/`menu-row.ts`/
 *    `account-menu-row.tsx`, no `flushSync`, no `MutationObserver`, no writes to
 *    `document.body`; the restart surface is a plain React component in the slot.
 */

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const require = createRequire(import.meta.url)

// --- the smallest DOM that can hold a <style> element -----------------------

/** `<style>` elements by id, in insertion order. */
const styleTags = new Map()

const head = {
  append(node) {
    styleTags.set(node.id, node)
    node.parentNode = head
    return node
  },
}

const document = {
  head,
  activeElement: null,
  documentElement: { dataset: {} },
  createElement(tag) {
    return {
      tagName: tag.toUpperCase(),
      id: '',
      textContent: '',
      dataset: {},
      parentNode: null,
      setAttribute() {},
      remove() {
        styleTags.delete(this.id)
        this.parentNode = null
      },
    }
  },
  getElementById(id) {
    return styleTags.get(id) ?? null
  },
  querySelector() {
    return null
  },
  addEventListener() {},
  removeEventListener() {},
}

globalThis.document = document
globalThis.window = {
  innerWidth: 1200,
  innerHeight: 800,
  addEventListener() {},
  removeEventListener() {},
}

/** The one route the store reads on load; it must not need a real Host. */
globalThis.fetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({ capability: { available: false, reason: 'host', activeTasks: -1 } }),
})

// --- capture the lazy factory ----------------------------------------------

/** Module specifiers the factory asked for, so the external list is provable. */
const required = []

const modules = {
  react: require('react'),
  'react-dom': require('react-dom'),
  'react/jsx-runtime': require('react/jsx-runtime'),
}

/** The artifact's own module scope: `require` sees only the browser module table. */
function loadArtifact(file = 'packages/dsh-quick-restart/lib/client.js', id = 'dsh-quick-restart') {
  required.length = 0
  let captured
  globalThis.window.__ModuleLoader__ = {
    load({ id: registered, factory }) {
      assert.equal(registered, id, 'the lazy factory id is the package name')
      captured = { id, exports: factory(specifier => {
        required.push(specifier)
        if (!(specifier in modules)) throw new Error(`the artifact required an unknown module: ${specifier}`)
        return modules[specifier]
      }) }
    },
  }
  const source = readFileSync(join(root, file), 'utf8')
  // The banner is a statement, not a module: run it the way the page would.
  new Function(source)()
  assert.ok(captured !== undefined, 'the artifact registered a lazy factory')
  return captured
}

// 1. Loading the artifact must not touch the page. The baseline has to be taken
// before the factory runs, otherwise the assertion compares a value with itself.
const stylesBeforeLoad = styleTags.size

/** The restart artifact, loaded once for both the export and the apply checks. */
const artifact = loadArtifact()

assert.equal(styleTags.size, stylesBeforeLoad, 'the factory has no side effects at load time')

// 2. Export shape.
assert.deepEqual(Object.keys(artifact.exports).sort(), ['apply', 'inject', 'name'])
assert.equal(artifact.exports.name, 'quick-restart', 'the restart bundle names itself so its slot entries are attributed to the package')
assert.equal(typeof artifact.exports.apply, 'function')

// 3. Dependencies: only real services, and only host-provided modules.
assert.deepEqual(artifact.exports.inject, ['slots', 'locale'])
assert.deepEqual([...new Set(required)].sort(), ['react', 'react/jsx-runtime'])
console.log('✓ the factory exports inject/apply and is inert until applied')

// --- a client context that records what it is handed -----------------------

/** Slot entries registered, in order. */
const registrations = []
/** `ctx.effect` calls, in order. */
const effects = []
/** Slots the plugin asked to be notified about. */
const injections = []
/** Locale namespaces registered. */
const namespaces = []

/** A client context that records registrations and keeps every effect's cleanup. */
function makeContext(tracker) {
  const ctx = {
    effect(body, label) {
      const dispose = typeof body === 'function' ? body() : body
      tracker.effects.push({ label, dispose })
      return () => {}
    },
    get(name) {
      if (name === 'slots') {
        return {
          inject(slot, callback) {
            tracker.injections.push(slot)
            const off = callback()
            return () => {
              off?.()
            }
          },
          register(entry) {
            const record = { entry }
            tracker.registrations.push(record)
            return () => {
              const index = tracker.registrations.indexOf(record)
              if (index >= 0) tracker.registrations.splice(index, 1)
            }
          },
        }
      }
      if (name === 'locale') {
        return {
          register(namespace) {
            tracker.namespaces.push(namespace)
            return () => {}
          },
          bind() {
            return key => key
          },
        }
      }
      return undefined
    },
    inject(names, callback) {
      callback(ctx)
      return () => {}
    },
  }
  return ctx
}

const ctx = makeContext({ effects, registrations, injections, namespaces })

const applied = artifact.exports.apply(ctx)
assert.equal(applied, undefined, 'apply is synchronous and returns nothing')

// 4. One header action for the restart component, in the seat the shell opens
// for a settings pane. The terminal registers `open-terminal` at order 100, so
// this one has to sort after it to land on its right.
assert.deepEqual(injections, ['settings.action'])
assert.deepEqual(
  registrations.map(record => `${record.entry.name}/${record.entry.id}`),
  ['settings.action/restart'],
)
for (const record of registrations) {
  assert.equal(record.entry.locale, 'dsh-quick-restart', `${record.entry.id} is translated through the component namespace`)
  assert.equal(typeof record.entry.order, 'number', `${record.entry.id} declares an order inside its list slot`)
  assert.ok(record.entry.order > 100, `${record.entry.id} sorts to the right of the terminal action (order > 100)`)
}
assert.deepEqual(namespaces, ['dsh-quick-restart'])
console.log('✓ the restart action seats into settings.action, right of the terminal')

// 5. Every resource was registered inside `ctx.effect`, with a label. One prefix
// for the whole plugin, the component as the qualifier: the inspector then shows
// a single owner and no two entries with the same name.
assert.deepEqual(effects.map(effect => effect.label), [
  'dsh-hello-world: ui stylesheet',
  'dsh-hello-world: restart locale',
  'dsh-hello-world: restart settings action',
  'dsh-hello-world: restart watch',
])
for (const effect of effects) {
  assert.equal(typeof effect.dispose, 'function', `effect "${effect.label}" returns a cleanup function`)
}

const baseCss = styleTags.get('dsh-hello-world/ui.css')?.textContent ?? ''
assert.notEqual(baseCss, '', 'the shared primitives are installed inside apply')
assert.equal(styleTags.has('dsh-hello-world/restart.css'), false, 'there is no second stylesheet any more: one shared sheet serves both bundles')
assert.match(baseCss, /\.dh-button-base\b/u, 'the shared sheet carries the button rules both bundles render')
assert.match(baseCss, /\[aria-disabled='true'\]/u, 'the shared sheet styles an aria-disabled control as not-activatable while keeping it focusable')
// No account-menu rule belongs in the sheet: nothing renders a menu row.
assert.doesNotMatch(baseCss, /\.dh-menu-row\b|\.dh-menu-host\b/u, 'the shared sheet stays free of account-menu selectors')
assert.doesNotMatch(baseCss, /#[0-9a-fA-F]{3,8}\b/u, 'no hard-coded colour: every rule references a theme token')
// Regression guard: the footer-row and tooltip styling is gone and must not return.
assert.doesNotMatch(baseCss, /\.dh-row\b|\.dh-tooltip\b/u, 'the removed footer row and tooltip styling stay gone')
console.log('✓ the shared stylesheet and the locale dictionary are installed inside apply')

// 6. The old account-menu seam is gone. Its files must not exist, and no client
// source may reintroduce the DOM writing it relied on.
for (const removed of ['src/client/attach.ts', 'src/client/menu-row.ts', 'src/client/account-menu-row.tsx']) {
  assert.equal(existsSync(join(root, removed)), false, `${removed} is removed`)
}

const indexSource = readFileSync(join(root, 'src/client/index.ts'), 'utf8')
assert.match(indexSource, /settings\.action/u, 'the controller is seated in the official settings header slot')
assert.doesNotMatch(indexSource, /shell\.overlay/u, 'the frame-wide overlay seat is no longer used')
assert.doesNotMatch(indexSource, /attach|menu-row|account-menu-row/u, 'the entry no longer references the DOM seam')
assert.doesNotMatch(indexSource, /installRestartStyles|restart\.css/u, 'the entry installs one sheet, not two')
assert.doesNotMatch(indexSource, /@deepseek-ai\/dsh-client-ui-primitives/u, 'the entry never imports the UI primitives')

const actionSource = readFileSync(join(root, 'src/client/restart-action.tsx'), 'utf8')
assert.match(actionSource, /action\.view/u, 'the button reads its label and state from the shared view')
assert.match(actionSource, /aria-disabled/u, 'a disabled restart keeps its refusal reason reachable from the keyboard')
assert.doesNotMatch(actionSource, /@deepseek-ai\/dsh-client-ui-primitives/u, 'the action never imports the UI primitives')

const stylesSource = readFileSync(join(root, 'src/client/styles.ts'), 'utf8')
assert.doesNotMatch(stylesSource, /installRestartStyles|RESTART_CSS|RESTART_STYLE_ID|restart\.css/u, 'the restart-only stylesheet is gone from the source')

for (const file of [
  'src/client/restart-action.tsx',
  'src/client/use-restart.tsx',
  'src/client/index.ts',
  'src/client/ui/icon.tsx',
]) {
  const source = readFileSync(join(root, file), 'utf8')
  assert.doesNotMatch(source, /document\.body|createPortal|MutationObserver|flushSync/u, `${file} writes no DOM outside its component tree`)
  assert.doesNotMatch(
    source,
    /@deepseek-ai\/dsh-client-ui-primitives/u,
    `${file} vendors its glyph instead of importing the UI primitives at runtime`,
  )
}
console.log('✓ the DOM seam is gone: the restart surface is a plain component in the slot')

// 7. The restart entry follows the live capability, and the watch that keeps it
// honest is disposable: a component switched off in the plugin manager must not
// leave an interval posting to a route that no longer exists.
const store = await import('../src/client/store.ts')
assert.equal(store.WATCH_POLL_MS, 5000, 'the status route is re-read every five seconds')
const stopWatch = store.watchRestart()
assert.equal(typeof stopWatch, 'function', 'the background revalidation hands back its own disposer')
stopWatch()

// A capability that did not change must not be republished: the snapshot is what
// the button, the dialog and the toast all subscribe to, so a fresh object every
// five seconds would re-render the tree and restart the toast's hold timer.
const capability = {
  supported: true,
  target: 'cli',
  managedBy: 'dsh-hello-world',
  supervisor: null,
  debugger: null,
  platform: 'linux',
  pid: 1,
  activeTasks: 0,
  state: 'idle',
  confirmBeforeRestart: true,
  refuseWhileBusy: false,
  version: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version,
  detail: 'replay the current command line',
  command: 'dsh web',
  logFile: '/tmp/dsh-hello-world.log',
}
store.setRestartCapability(capability)
const published = store.restartSnapshot().capability
assert.notEqual(published, undefined, 'the capability reached the snapshot')
store.setRestartCapability({ ...capability })
assert.equal(store.restartSnapshot().capability, published, 'an unchanged capability keeps its identity')
store.setRestartCapability({ ...capability, state: 'restarting' })
assert.notEqual(store.restartSnapshot().capability, published, 'a changed capability is republished')
// The confirm dialog must show the command line the next Host will run. It is a
// fact the capability already carries; a dialog that drops it describes a plan
// the user cannot see.
const restartSource = readFileSync(join(root, 'src/client/use-restart.tsx'), 'utf8')
assert.match(restartSource, /capability\?\.command/u, 'the dialog reads the command from the capability')
assert.match(restartSource, /t\('dialog\.command\.label'\)/u, 'the dialog labels the command row')
const { DICTIONARIES } = await import('../src/client/locales.ts')
for (const [name, dictionary] of Object.entries(DICTIONARIES)) {
  assert.equal(typeof dictionary['dialog.command.label'], 'string', `the ${name} dictionary labels the command row`)
  assert.equal(typeof dictionary['dialog.command.note'], 'string', `the ${name} dictionary explains the command row`)
}
console.log('✓ the restart entry follows the live capability and stops when unloaded')

// 8. Teardown: an unload must leave no <style> and no slot entry behind.
for (const effect of effects) effect.dispose()
assert.equal(styleTags.size, 0, 'the stylesheets are removed on dispose')
assert.equal(registrations.length, 0, 'the slot entry is removed on dispose')
console.log('✓ disposing every effect leaves no stylesheet and no slot entry behind')

// 9. The shared sheet is counted on the document, because the two bundles are
// separate module instances in one page: the first one to unload must not remove
// the element the other one still renders with. Two imports of the module stand
// in for the two bundles.
const stylesA = await import('../src/client/styles.ts?owner=a')
const stylesB = await import('../src/client/styles.ts?owner=b')
assert.notEqual(stylesA.installBaseStyles, stylesB.installBaseStyles, 'the two owners are separate module instances')

const releaseA = stylesA.installBaseStyles(document)
const releaseB = stylesB.installBaseStyles(document)
assert.equal(styleTags.size, 1, 'both owners share one <style> element')
assert.equal(document.documentElement.dataset.dshHelloWorldUiCss, '2', 'the document holds the owner count')

releaseA()
assert.equal(styleTags.has(stylesA.BASE_STYLE_ID), true, 'the first release leaves the sheet the other owner renders with')
releaseA()
assert.equal(document.documentElement.dataset.dshHelloWorldUiCss, '1', 'a repeated release does not count twice')
releaseB()
assert.equal(styleTags.size, 0, 'the last release removes the element')
assert.equal(document.documentElement.dataset.dshHelloWorldUiCss, undefined, 'the last release drops the count')
console.log('✓ the shared stylesheet is reference-counted across bundles')

// 10. The terminal component is a separate package with its own bundle: one
// settings-header action, its own locale namespace, and no reach into the
// restart surface. Switching that package off unmounts exactly this bundle, so
// its button disappears without a reload.
const terminalArtifact = loadArtifact('packages/dsh-quick-terminal/lib/client.js', 'dsh-quick-terminal')
assert.deepEqual(Object.keys(terminalArtifact.exports).sort(), ['apply', 'inject', 'name'])
assert.equal(terminalArtifact.exports.name, 'quick-terminal', 'the terminal bundle names itself so its slot entries are attributed to the package')
assert.deepEqual(terminalArtifact.exports.inject, ['slots', 'locale'])

const terminalTracker = { effects: [], registrations: [], injections: [], namespaces: [] }
const terminalCtx = makeContext(terminalTracker)
assert.equal(terminalArtifact.exports.apply(terminalCtx), undefined, 'the terminal apply returns nothing')
assert.deepEqual(terminalTracker.injections, ['settings.action'])
assert.deepEqual(
  terminalTracker.registrations.map(record => `${record.entry.name}/${record.entry.id}`),
  ['settings.action/open-terminal'],
)
assert.deepEqual(terminalTracker.namespaces, ['dsh-quick-terminal'])
assert.deepEqual(terminalTracker.effects.map(effect => effect.label), [
  'dsh-hello-world: ui stylesheet',
  'dsh-hello-world: terminal locale',
  'dsh-hello-world: terminal settings action',
])
assert.ok(styleTags.has('dsh-hello-world/ui.css'), 'the terminal bundle installs the shared primitives')
for (const effect of terminalTracker.effects) effect.dispose()
assert.equal(terminalTracker.registrations.length, 0, 'the terminal action is removed on dispose')
assert.equal(styleTags.size, 0, 'the terminal stylesheet is removed on dispose')

// Both bundles must carry the same shared sheet and no account-menu rules.
const terminalBundle = readFileSync(join(root, 'packages/dsh-quick-terminal/lib/client.js'), 'utf8')
assert.doesNotMatch(terminalBundle, /\.dh-menu-row\b|\.dh-menu-host\b/u, 'the terminal bundle carries no account-menu rules')
console.log('✓ the terminal package is a separate bundle with its own seat, namespace and shared primitives')

// 11. The settings action is painted optimistically: it belongs to the header's
// first commit, beside the actions the Host ships, so nothing about it may wait
// for a round trip. The probe may only ever hide it, and only when the Host
// answers that this component's route is not mounted — a Host that is merely
// unreachable (a restart in progress) must leave the button alone.
const api = await import('../src/client/api.ts')
const realFetch = globalThis.fetch
/** A fetch stand-in that answers with one status and one JSON body. */
const answering = (status, body) => async () => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
})
try {
  globalThis.fetch = answering(200, { ok: true, available: true, platform: 'linux' })
  assert.equal(await api.fetchTerminalStatus(), 'available', 'a mounted component answers available')
  globalThis.fetch = answering(200, { ok: false, error: 'not mounted' })
  assert.equal(await api.fetchTerminalStatus(), 'unavailable', 'an answer without availability is a definitive no')
  globalThis.fetch = answering(404, {})
  assert.equal(await api.fetchTerminalStatus(), 'unavailable', 'a missing route means the component is unmounted')
  globalThis.fetch = answering(500, {})
  assert.equal(await api.fetchTerminalStatus(), 'unknown', 'a Host error is not an answer about the component')
  globalThis.fetch = async () => {
    throw new TypeError('fetch failed')
  }
  assert.equal(await api.fetchTerminalStatus(), 'unknown', 'a dropped connection is not an answer about the component')
} finally {
  globalThis.fetch = realFetch
}

// The behaviour above only matters if the button uses it: the render path must
// not be gated on a probe, and only a definitive answer may hide the action.
const terminalSource = readFileSync(join(root, 'src/terminal/client.tsx'), 'utf8')
assert.doesNotMatch(terminalSource, /if \(!available\)/u, 'the action is not gated on a probe before its first paint')
assert.match(terminalSource, /answer === 'unavailable'/u, 'only a definitive answer hides the action')
console.log('✓ the terminal action paints first and is hidden only by a definitive answer')

console.log('\nall client-half checks passed')
