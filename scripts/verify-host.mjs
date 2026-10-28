/**
 * Host-half verification: mount the BUILT plugin against a stub context.
 *
 * This is not a unit test of internals — it imports `lib/index.js` exactly as the
 * Harness loader would, hands it a context whose `inject` fires immediately, and
 * calls the routes the way the client does. It therefore proves the shipped
 * bundle registers routes and answers with the documented shapes.
 *
 * Two habits keep this honest:
 *
 * - unmounting runs the disposers the plugin registered, because that is what the
 *   plugin manager does when a component is switched off. Clearing the route map
 *   by hand would prove nothing about the lifecycle;
 * - the diagnostic log is redirected to a sandbox directory for the whole run, so
 *   the checks never append to (or rotate away) a developer's real log.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { configWith, logLineCount } from './fixtures.mjs'

const { ROUTE_RESTART, ROUTE_STATUS, ROUTE_TERMINAL, ROUTE_TERMINAL_STATUS } = await import('../src/shared/protocol.ts')

/** Routes registered by the current mounts, keyed by path. */
const routes = new Map()

/** Diagnostic log for this run, and the variables that point the plugin at it. */
const sandbox = mkdtempSync(join(tmpdir(), 'dsh-hello-world-verify-'))
const logPath = join(sandbox, 'diagnostics.log')
const LOG_ENV = ['DSH_HELLO_WORLD_LOG', 'DSH_JUST_RESTART_LOG']
const savedEnv = new Map(LOG_ENV.map(name => [name, process.env[name]]))

/**
 * A context whose `inject` fires immediately and whose effects are recorded.
 * @param {Record<string, unknown>} services - what `ctx.get` answers.
 * @returns {{ ctx: object, disposers: (() => void)[] }} the context and its teardown list.
 */
function makeContext(services) {
  const disposers = []
  const ctx = {
    effect(body) {
      const dispose = typeof body === 'function' ? body() : body
      if (typeof dispose === 'function') disposers.push(dispose)
      return dispose
    },
    get(name) {
      return services[name]
    },
    inject(names, callback) {
      if (names.every(name => services[name] !== undefined)) callback(ctx)
      return ctx
    },
    logger() {
      return { info() {}, warn() {}, error() {}, debug() {} }
    },
  }
  return { ctx, disposers }
}

/** The connection service the routes are registered through. */
function connectionStub() {
  return {
    fetch: {
      register(route) {
        routes.set(route.path, route)
        return () => { routes.delete(route.path) }
      },
    },
  }
}

/**
 * Mount one component and return its unmount.
 *
 * Unmounting runs every effect disposer the mount created, which is exactly what
 * switching the component off in the plugin manager does. Asserting the route map
 * is empty afterwards is therefore a real statement about the lifecycle gate.
 * @param {(ctx: object, config?: object) => void} apply - the component entry.
 * @param {Record<string, unknown>} services - services for `ctx.get`.
 * @param {object} [config] - restart config snapshot.
 * @returns {() => void} unmount.
 */
function mount(apply, services, config) {
  const { ctx, disposers } = makeContext(services)
  apply(ctx, config)
  return () => {
    for (const dispose of disposers.splice(0).reverse()) dispose()
  }
}

/**
 * POST a route the way the page does and decode the body.
 * @param {string} path - route path.
 * @param {Record<string, string>} [headers] - extra request headers.
 * @returns {Promise<{ status: number, headers: Headers, body: any }>} the answer.
 */
async function post(path, headers = {}) {
  const route = routes.get(path)
  assert.ok(route !== undefined, `${path} must be registered`)
  const response = await route.fetch(new Request(`http://127.0.0.1${path}`, {
    method: 'POST',
    headers: { host: '127.0.0.1', ...headers },
  }))
  return { status: response.status, headers: response.headers, body: await response.json() }
}

/** Read the capability the way the row does. */
async function readStatus() {
  return (await post(ROUTE_STATUS)).body
}

const { apply: applyRestart } = await import('../packages/dsh-quick-restart/lib/index.js')
const { apply: applyTerminal } = await import('../packages/dsh-quick-terminal/lib/index.js')

try {
  for (const name of LOG_ENV) process.env[name] = logPath

  // 1. Mount with only `connection`: the routes appear, and unmounting removes
  //    them again — the component switch is a lifecycle gate, not a policy flag.
  {
    const unmount = mount(applyRestart, { connection: connectionStub() }, configWith({ refuseWhileBusy: true }))
    assert.deepEqual([...routes.keys()].sort(), [ROUTE_RESTART, ROUTE_STATUS].sort())
    for (const route of routes.values()) {
      assert.deepEqual(route.methods, ['POST'])
      assert.equal(route.requestBody, 'buffered')
    }
    console.log("✓ routes registered through ctx.inject(['connection'])")
    unmount()
    assert.equal(routes.size, 0, 'unmounting the restart component removes its routes')
    console.log('✓ unmounting the restart component removes both routes')
  }

  // 2. Status: busy because the agents/jobs services are absent (unknown, not zero).
  {
    const unmount = mount(applyRestart, { connection: connectionStub() }, configWith({ refuseWhileBusy: true }))
    const response = await post(ROUTE_STATUS)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(response.body.ok, true)
    const capability = response.body.capability
    assert.equal(capability.activeTasks, -1)
    assert.equal(capability.supported, false)
    assert.equal(capability.reason, 'busy')
    assert.equal(capability.target, 'cli')
    assert.equal(capability.managedBy, 'dsh-hello-world')
    assert.equal(capability.confirmBeforeRestart, true)
    assert.equal('placement' in capability, false, 'the capability carries no placement policy anymore')
    console.log('✓ status reports busy + activeTasks=-1 when the task services are absent')

    // 3. A busy restart is refused with the reason, and does NOT arm a watchdog.
    const refused = await post(ROUTE_RESTART, { origin: 'http://127.0.0.1' })
    assert.equal(refused.status, 200)
    assert.equal(refused.body.ok, false)
    assert.equal(refused.body.reason, 'busy')
    assert.match(refused.body.error, /cannot be inspected|active task/u)
    assert.equal(refused.body.plan, undefined, 'a refusal carries no plan')
    console.log('✓ a busy restart is refused, not silently ignored')

    // 4. A cross-site restart request is refused before any decision is taken.
    const crossSite = await post(ROUTE_RESTART, { origin: 'http://evil.example', 'sec-fetch-site': 'cross-site' })
    assert.equal(crossSite.body.ok, false)
    assert.equal(crossSite.body.error, 'the request origin is not trusted by the Host')
    console.log('✓ a cross-site restart request is refused')
    unmount()
  }

  // 4b. The terminal route refuses the same way, before it starts anything. This
  // case must stay the only terminal request in this script: a trusted request
  // would open a real window.
  {
    const unmount = mount(applyTerminal, { connection: connectionStub() })
    const refused = await post(ROUTE_TERMINAL, { origin: 'http://evil.example', 'sec-fetch-site': 'cross-site' })
    assert.equal(refused.status, 200)
    assert.equal(refused.body.ok, false)
    assert.equal(refused.body.error, 'the request origin is not trusted by the Host')
    console.log('✓ a cross-site terminal request is refused')

    // 8. The availability probe answers without opening anything, so the client
    // can tell "component switched off" (route gone) from "no window could be
    // opened" (route answers failure).
    const probe = await post(ROUTE_TERMINAL_STATUS)
    assert.equal(probe.body.ok, true)
    assert.equal(probe.body.available, true)
    assert.equal(probe.body.platform, process.platform)
    console.log('✓ the terminal availability probe reports the component, not a launch')
    unmount()
  }

  // 5. `enabled: false` is a policy refusal, not a lifecycle switch: the component
  //    stays mounted, because the route surface is how the row explains itself, and
  //    the refusal sentence comes from the same rule that produced the reason.
  {
    const unmount = mount(applyRestart, { connection: connectionStub() }, configWith({ enabled: false }))
    assert.deepEqual(
      [...routes.keys()].sort(),
      [ROUTE_RESTART, ROUTE_STATUS].sort(),
      'a disabled capability still answers: unmounting it is the component switch, not this option',
    )
    const capability = (await readStatus()).capability
    assert.equal(capability.supported, false)
    assert.equal(capability.reason, 'disabled')
    assert.equal(capability.managedBy, 'operator')
    assert.equal(capability.detail, 'replay the current command line', 'detail describes the action, not the refusal')
    const refused = await post(ROUTE_RESTART)
    assert.equal(refused.body.ok, false)
    assert.equal(refused.body.reason, 'disabled')
    assert.equal(refused.body.error, 'restart is disabled by the plugin configuration')
    console.log('✓ enabled=false is a policy refusal: the capability explains itself and /restart refuses')
    unmount()
  }

  // 6. `commands` registered late still gets `/restart`.
  {
    const lateServices = { connection: connectionStub() }
    const { ctx, disposers } = makeContext(lateServices)
    const pending = []
    ctx.inject = (names, callback) => {
      if (names.every(name => lateServices[name] !== undefined)) callback(ctx)
      else pending.push(() => callback(ctx))
      return ctx
    }
    applyRestart(ctx, configWith({ refuseWhileBusy: true }))
    const commands = []
    lateServices.commands = {
      register(definition) {
        commands.push(definition)
        return () => {}
      },
    }
    for (const fire of pending) fire()
    assert.equal(commands.length, 1)
    assert.equal(commands[0].name, 'restart')
    assert.equal(commands[0].input.hint, '[--force]')

    const invocation = rawInput => commands[0].handler({
      commandId: 1,
      agent: {},
      rawInput,
      attachments: [],
      signal: new AbortController().signal,
    })
    const unknown = invocation('--bogus')
    assert.equal(unknown.kind, 'error')
    assert.match(unknown.text, /Unknown option/u)
    for (const dispose of disposers.splice(0).reverse()) dispose()
  }

  // 6b. `--force` may override "busy" but never an absolute refusal. `enabled:
  //     false` is absolute, so the same flag must still be refused — proof the
  //     override is scoped instead of turning the guard off. The command text is
  //     also checked for exactly one sentence, which is what the double-period bug
  //     produced before.
  {
    const services = { connection: connectionStub() }
    const { ctx, disposers } = makeContext(services)
    const commands = []
    services.commands = {
      register(definition) {
        commands.push(definition)
        return () => {}
      },
    }
    applyRestart(ctx, configWith({ enabled: false }))
    const forced = commands[0].handler({
      commandId: 1,
      agent: {},
      rawInput: '--force',
      attachments: [],
      signal: new AbortController().signal,
    })
    assert.equal(forced.kind, 'error')
    assert.match(forced.text, /Restart refused: restart is disabled/u)
    assert.doesNotMatch(forced.text, /\.\.$/u, 'the sentence ends with exactly one period')
    console.log('✓ /restart registers when ctx.commands appears later; --force cannot override an absolute refusal')
    for (const dispose of disposers.splice(0).reverse()) dispose()
  }

  // 7. Each component is its own package, so a package switch really unmounts its
  //    routes: the restart package carries status+restart, the terminal package
  //    carries open+availability. Both are installed together in the shipped setup.
  {
    const unmountRestart = mount(applyRestart, { connection: connectionStub() }, configWith({ refuseWhileBusy: true }))
    assert.deepEqual([...routes.keys()].sort(), [ROUTE_RESTART, ROUTE_STATUS].sort())
    unmountRestart()
    assert.equal(routes.size, 0, 'the restart package leaves nothing behind')

    const unmountTerminal = mount(applyTerminal, { connection: connectionStub() })
    assert.deepEqual([...routes.keys()].sort(), [ROUTE_TERMINAL, ROUTE_TERMINAL_STATUS].sort())
    unmountTerminal()
    assert.equal(routes.size, 0, 'the terminal package leaves nothing behind')

    const unmountBothRestart = mount(applyRestart, { connection: connectionStub() }, configWith({ refuseWhileBusy: true }))
    const unmountBothTerminal = mount(applyTerminal, { connection: connectionStub() })
    assert.deepEqual(
      [...routes.keys()].sort(),
      [ROUTE_RESTART, ROUTE_STATUS, ROUTE_TERMINAL, ROUTE_TERMINAL_STATUS].sort(),
    )
    unmountBothTerminal()
    assert.deepEqual([...routes.keys()].sort(), [ROUTE_RESTART, ROUTE_STATUS].sort(), 'one switch removes one half')
    unmountBothRestart()
    console.log('✓ the restart and terminal packages register disjoint routes and unmount independently')
  }

  // 8b. The status route is polled every few seconds, so it must write a line only
  //     when the answer changes — otherwise a heartbeat pushes the restart evidence
  //     out of the single rotated generation.
  {
    const unmountDisabled = mount(applyRestart, { connection: connectionStub() }, configWith({ enabled: false }))
    await readStatus()
    const settled = logLineCount(logPath)
    await readStatus()
    assert.equal(logLineCount(logPath), settled, 'a repeated identical status must not append to the log')
    unmountDisabled()

    const unmountEnabled = mount(applyRestart, { connection: connectionStub() }, configWith({ refuseWhileBusy: false }))
    const beforeFlip = logLineCount(logPath)
    await readStatus()
    assert.ok(logLineCount(logPath) > beforeFlip, 'a capability that changed is worth one line')
    unmountEnabled()
    console.log('✓ /status logs a line only when the capability changes')
  }

  // 9. The diagnostic log stays bounded. The README promises rotation to `.1`
  //    past 512 KiB; an uncapped file grows for as long as the Host runs.
  {
    const logBudget = 512 * 1024
    const rotationDir = mkdtempSync(join(tmpdir(), 'dsh-hello-world-log-'))
    const rotationPath = join(rotationDir, 'diagnostics.log')
    try {
      for (const name of LOG_ENV) process.env[name] = rotationPath
      writeFileSync(rotationPath, 'x'.repeat(logBudget + 1))
      const unmount = mount(applyRestart, { connection: connectionStub() }, configWith({ refuseWhileBusy: true }))
      unmount()
      assert.equal(statSync(`${rotationPath}.1`).size, logBudget + 1, 'the archive is exactly the file that was rotated')
      assert.ok(statSync(rotationPath).size < logBudget, 'the live log starts a new generation')

      // A second rotation replaces the archive instead of failing: a rename that
      // hits a locked target is retried after removing it.
      writeFileSync(rotationPath, 'y'.repeat(logBudget + 1))
      const again = mount(applyRestart, { connection: connectionStub() }, configWith({ refuseWhileBusy: true }))
      again()
      assert.equal(statSync(`${rotationPath}.1`).size, logBudget + 1, 'the archive is replaced, not appended to')
      assert.ok(statSync(rotationPath).size < logBudget, 'the live log is capped again')
    } finally {
      for (const name of LOG_ENV) process.env[name] = logPath
      rmSync(rotationDir, { recursive: true, force: true })
    }
    console.log('✓ the diagnostic log rotates to `.1` past 512 KiB and replaces the archive')
  }

  // 10. The success path: nothing refuses, the route answers with the plan before
  //     the process leaves, and the state machine moves to `restarting`. The
  //     watchdog it arms is stopped immediately — `delayMs` keeps it asleep for
  //     five seconds, so killing it here is what makes this check safe to run.
  {
    const unmount = mount(applyRestart, { connection: connectionStub() }, configWith({
      allowSupervisor: true,
      refuseWhileBusy: false,
      delayMs: 5000,
    }))
    const capability = (await readStatus()).capability
    assert.equal(capability.supported, true, 'nothing refuses this restart')
    assert.equal(capability.state, 'idle')

    const scheduled = await post(ROUTE_RESTART)
    assert.equal(scheduled.body.ok, true, `a supported restart must be accepted, got ${JSON.stringify(scheduled.body)}`)
    const plan = scheduled.body.plan
    assert.equal(plan.target, 'cli')
    assert.equal(plan.pid, process.pid, 'the plan names the Host that is about to leave')
    assert.ok(Number.isInteger(plan.helperPid), 'the watchdog pid is reported so it can be stopped')
    assert.ok(plan.waits.includes(`host ${process.pid}`), 'the plan waits for this Host to exit')
    assert.ok(plan.logFile !== undefined)

    process.kill(plan.helperPid)
    await new Promise(resolve => setTimeout(resolve, 250))
    assert.throws(() => process.kill(plan.helperPid, 0), /ESRCH/u, 'the watchdog is gone')

    const during = (await readStatus()).capability
    assert.equal(during.state, 'restarting')
    assert.equal(during.reason, 'host')
    assert.equal(during.supported, false)
    console.log('✓ a supported restart answers with its plan, then reports `restarting`')
    unmount()
  }

  console.log('\nall host-half checks passed')
} finally {
  for (const [name, value] of savedEnv) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  rmSync(sandbox, { recursive: true, force: true })
}
