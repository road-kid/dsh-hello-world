/**
 * Plan verification: what WOULD be launched, without launching it.
 *
 * `buildPlan` is the single place that decides between replaying a command line
 * and relaunching the desktop application, so it is checked directly for both
 * deployments. Nothing here spawns a process.
 */
import assert from 'node:assert/strict'

import { configWith } from './fixtures.mjs'

// `src/`, not `lib/`: these are internal decisions, and the built bundle
// deliberately exports only the plugin surface. Node strips the types itself.
const { buildPlan, restartTarget } = await import('../src/restart/index.ts')

function ctxWith(services) {
  return {
    effect: () => () => {},
    get: name => services[name],
    inject: (names, callback) => { callback(ctxWith(services)); return ctxWith(services) },
    logger: () => ({ info() {}, warn() {}, error() {}, debug() {} }),
  }
}

// `refuseWhileBusy` is off here on purpose: these checks describe where a restart
// would go, and a busy Host would only add a refusal in front of the plan.
const config = configWith({ refuseWhileBusy: false })

const ctx = ctxWith({ webServer: { port: 39891 }, profileContext: { name: 'desktop' } })

// 1. Desktop: the whole application is relaunched, Electron node mode removed.
{
  const saved = process.env.ELECTRON_RUN_AS_NODE
  let plan
  try {
    process.env.ELECTRON_RUN_AS_NODE = '1'
    plan = buildPlan(ctx, config)
  } finally {
    // Restore rather than assign a copy of the whole environment: a replacement
    // `process.env` object would drop anything another check added meanwhile.
    if (saved === undefined) delete process.env.ELECTRON_RUN_AS_NODE
    else process.env.ELECTRON_RUN_AS_NODE = saved
  }
  assert.equal(plan.target, 'desktop')
  assert.equal(plan.hostPid, process.pid)
  assert.equal(plan.shellPid, process.ppid)
  // NSIS passes `--updated` when it relaunches after an install, and the app
  // raises its window in response; a relaunch we perform is the same situation.
  assert.deepEqual(plan.launch.args, process.platform === 'win32' ? ['--updated'] : [])
  assert.deepEqual(plan.launch.unsetEnv, ['ELECTRON_RUN_AS_NODE'], 'the app must not start in node mode')
  assert.equal(plan.launch.file, process.execPath)
  assert.equal(plan.launch.hideWindow, false, 'a hidden spawn would produce a tray-only launch')
  assert.ok(plan.logFile.length > 0)
  console.log(`✓ desktop plan relaunches ${plan.launch.file} (shell ${plan.shellPid}, host ${plan.hostPid})`)
}

// 2. Command line: the same entry point is replayed through node.
{
  const plan = buildPlan(ctxWith({ webServer: { port: 4599 }, profileContext: { name: 'default' } }), config)
  assert.equal(plan.target, 'cli')
  assert.equal(plan.port, 4599)
  assert.equal(plan.shellPid, undefined)
  assert.ok(plan.launch.args.some(argument => /bin\.js$/u.test(argument)) || plan.launch.viaShell === true)
  console.log(`✓ command-line plan replays ${plan.launch.file} ${plan.launch.args.join(' ')}`.trim())
}

// 3. Target detection prefers the Electron node-mode marker over the profile name.
assert.equal(restartTarget({ ELECTRON_RUN_AS_NODE: '1' }, ['node', '/x/@deepseek-ai/dsh-desktop-host/lib/index.js']), 'desktop')
assert.equal(restartTarget({}, ['node', '/x/lib/bin.js'], undefined), 'cli')
assert.equal(restartTarget({}, ['node', '/x/lib/bin.js'], { name: 'desktop' }), 'desktop')
console.log('✓ target detection: Electron node mode and desktop profile, else command line')

// 4. The supervisor and debugger guards answer from their injectable inputs, so
//    every branch is provable on any platform (the real call passes process.*).
{
  const { detectedSupervisor, detectedDebugger, trustedLocalRequest } = await import('../src/restart/guards.ts')
  assert.equal(detectedSupervisor({ INVOCATION_ID: 'x' }, 1, () => 'node'), 'systemd', 'systemd unit at pid 1')
  assert.equal(detectedSupervisor({ JOURNAL_STREAM: '1:2' }, 42, () => 'systemd'), 'systemd', 'systemd parent comm')
  assert.equal(detectedSupervisor({ INVOCATION_ID: 'x' }, 42, () => 'bash'), null, 'a variable alone is not a supervisor')
  assert.equal(detectedSupervisor({ PM2_HOME: '/x' }, 42, () => 'node'), 'pm2')
  // launchd exists only on macOS, so the marker is honoured only there.
  assert.equal(
    detectedSupervisor({ XPC_SERVICE_NAME: 'x' }, 42, () => 'launchd'),
    process.platform === 'darwin' ? 'launchd' : null,
    'launchd is macOS-only',
  )
  assert.equal(detectedSupervisor({ SUPERVISOR_ENABLED: '1' }, 42, () => 'node'), 'supervisord')
  assert.equal(detectedSupervisor({}, 42, () => 'node'), null)

  assert.equal(detectedDebugger('ws://127.0.0.1:9229/x', [], ''), 'inspector', 'an open inspector')
  assert.equal(detectedDebugger(undefined, ['--inspect=127.0.0.1:9229'], ''), 'inspector', 'execArgv')
  assert.equal(detectedDebugger(undefined, [], '--inspect-brk'), 'inspector', 'NODE_OPTIONS')
  assert.equal(detectedDebugger(undefined, [], '--inspect-port=1'), 'inspector', 'a bare inspect port')
  assert.equal(detectedDebugger(undefined, [], '--not-inspect'), null, 'a near-miss flag is not a debugger')
  console.log('✓ supervisor and debugger guards classify every supported case')

  const request = headers => new Request('http://127.0.0.1/api/x', { method: 'POST', headers })
  assert.equal(trustedLocalRequest(request({ host: '127.0.0.1:39891' })), true, 'no Origin (the desktop proxy)')
  assert.equal(trustedLocalRequest(request({ host: '127.0.0.1:39891', origin: 'http://127.0.0.1:39891' })), true, 'same origin')
  assert.equal(trustedLocalRequest(request({ host: '127.0.0.1:39891', origin: 'dsh-app://app' })), true, 'the desktop scheme')
  assert.equal(trustedLocalRequest(request({ host: '127.0.0.1:39891', origin: 'http://evil.example' })), false, 'another origin')
  assert.equal(trustedLocalRequest(request({ host: '127.0.0.1:39891', 'x-forwarded-for': '1.2.3.4' })), false, 'forwarded header')
  assert.equal(trustedLocalRequest(request({ host: '127.0.0.1:39891', 'sec-fetch-site': 'cross-site' })), false, 'cross-site fetch')
  assert.equal(trustedLocalRequest(request({ host: 'evil.example' })), false, 'a non-loopback authority')
  assert.equal(trustedLocalRequest(request({ host: 'rebound.example:39891', origin: 'http://rebound.example:39891' })), false, 'DNS rebinding')
  assert.equal(trustedLocalRequest(request({ host: 'localhost:39891', origin: 'http://localhost:39891' })), true, 'localhost')
  assert.equal(trustedLocalRequest(request({ host: '[::1]:39891', origin: 'http://[::1]:39891' })), true, 'IPv6 loopback')
  console.log('✓ request-origin guard accepts loopback/same-origin and rejects proxies')
}

// 5. A `--port 0` replay keeps the port the Host actually bound, and a web
//    replay suppresses the browser the replacement would otherwise open.
{
  const { cliLaunch } = await import('../src/restart/launch.ts')
  const source = cliLaunch(['node', '/x/apps/cli/src/bin.ts', 'web', '--port', '0'], ['--import', 'tsx/esm'], 'linux', '/usr/bin/node', 47071)
  const portAt = source.args.indexOf('--port')
  assert.notEqual(portAt, -1, 'the replayed port flag survives')
  assert.equal(source.args[portAt + 1], '47071', 'a zero port becomes the port the Host is listening on')
  assert.equal(source.args.at(-1), '--no-open', 'the replacement must not open a second browser tab')

  const inline = cliLaunch(['node', '/x/lib/bin.js', 'web', '--port=0'], [], 'linux', '/usr/bin/node', 5000)
  assert.ok(inline.args.includes('--port=5000'), 'the equals form is rewritten too')
  assert.equal(inline.args.at(-1), '--no-open')

  const profile = cliLaunch(['node', '/x/lib/bin.js', '--profile', 'web'], [], 'linux', '/usr/bin/node', 5000)
  assert.equal(profile.args.at(-1), '--no-open', '`--profile web` is a web invocation as well')

  const explicit = cliLaunch(['node', '/x/lib/bin.js', 'web', '--no-open'], [], 'linux', '/usr/bin/node', 5000)
  assert.equal(explicit.args.filter(argument => argument === '--no-open').length, 1, 'an explicit --no-open is not duplicated')

  const tui = cliLaunch(['node', '/x/lib/bin.js', 'tui'], [], 'linux', '/usr/bin/node', undefined)
  assert.ok(!tui.args.includes('--no-open'), 'a non-web invocation is replayed unchanged')
  console.log('✓ zero-port replays keep the bound port and web replays suppress the browser')
}

// 6. The generated watchdog embeds its constants instead of naming them: it runs
//    from `node -e` and has no module scope to resolve a constant from.
{
  const { helperSource } = await import('../src/restart/helper.ts')
  const plan = buildPlan(ctxWith({ webServer: { port: 4599 }, profileContext: { name: 'default' } }), config)
  const source = helperSource(plan)
  assert.ok(!source.includes('DESKTOP_SETTLE_MS'), 'the settle constant is inlined, not referenced')
  assert.ok(source.includes('Math.min(plan.settleTimeoutMs, 4000)'), 'the desktop settle window is inlined')
  console.log('✓ generated watchdog embeds the desktop settle window')
}


// 7. The open-terminal action: where it opens, what it prints, and which launcher
//    each platform gets. The plans are plain data, so nothing here opens a window;
//    the one `openTerminal` call uses a platform with no launcher and must fail
//    with a message instead of spawning.
{
  // The scratch tree holds the fake profile, the fake PATH entry and the scripts
  // each plan writes; remove it even when an assertion below fails.
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const scratch = mkdtempSync(join(tmpdir(), 'dsh-hello-world-plan-'))
  try {
    const { LINUX_TERMINALS, bannerLines, homeOfProfile, openTerminal, profileCommands, resolveInstallationRoot, terminalDirectory, terminalPlan } = await import('../src/terminal/index.ts')

    const profileDir = join(scratch, 'profile')
    const homeDir = join(scratch, 'home')
    mkdirSync(profileDir)
    mkdirSync(join(homeDir, 'profiles', 'web'), { recursive: true })

    // 7a. Profile directory: the service wins, then DSH_PROFILE_DIR, then DSH_HOME/profiles/<profile>.
    assert.equal(terminalDirectory(ctxWith({ profileContext: { dir: profileDir } }), { DSH_PROFILE_DIR: homeDir }, scratch), profileDir, 'profileContext.dir wins')
    assert.equal(terminalDirectory(ctxWith({}), { DSH_PROFILE_DIR: profileDir }, scratch), profileDir, 'DSH_PROFILE_DIR is the second choice')
    assert.equal(terminalDirectory(ctxWith({}), { DSH_HOME: homeDir, DSH_PROFILE: 'web' }, scratch), join(homeDir, 'profiles', 'web'), 'DSH_HOME + profile is the third')
    assert.equal(terminalDirectory(ctxWith({}), {}, scratch), scratch, 'a bare process falls back to its working directory')
    assert.equal(terminalDirectory(ctxWith({}), { DSH_PROFILE_DIR: join(scratch, 'missing') }, scratch), scratch, 'a directory that does not exist is not used')

    // 7a'. Directory: the banner names the root of the DSH this Host
    //      runs from, so the line is worth printing next to the DSH home. A
    //      packaged install answers with its installation directory — the `.app`
    //      bundle on macOS, where the executable sits two levels down — a source
    //      checkout with the workspace root above the CLI package, and a published
    //      install with the package directory itself, because nothing above it
    //      belongs to the product.
    {
      const packaged = join(scratch, 'packaged')
      mkdirSync(join(packaged, 'resources', 'app.asar'), { recursive: true })
      writeFileSync(
        join(packaged, 'resources', 'package.json'),
        JSON.stringify({ name: '@deepseek-ai/dsh-desktop', version: '1.2.3' }),
      )
      assert.equal(
        resolveInstallationRoot(join(packaged, 'DeepSeek Harness.exe'), []),
        packaged,
        'a packaged install prints the directory the executable sits in',
      )

      // The desktop build that ships without `resources/package.json`: the archive
      // alone still says where the app is installed, which is the whole question.
      const bare = join(scratch, 'bare')
      mkdirSync(join(bare, 'resources', 'app.asar', 'dsh'), { recursive: true })
      mkdirSync(join(bare, 'resources', 'app.asar.unpacked'), { recursive: true })
      assert.equal(
        resolveInstallationRoot(join(bare, 'DeepSeek Harness.exe'), []),
        bare,
        'an install without a resources manifest is still an install',
      )

      // The same install started through its bundled runtime, one level deeper.
      const runtime = join(scratch, 'runtime-install')
      mkdirSync(join(runtime, 'resources', 'app.asar'), { recursive: true })
      const nodeExe = join(runtime, 'resources', 'runtime', 'bin', 'node.exe')
      mkdirSync(join(runtime, 'resources', 'runtime', 'bin'), { recursive: true })
      assert.equal(
        resolveInstallationRoot(nodeExe, []),
        runtime,
        'the bundled runtime climbs to the installation it belongs to',
      )

      const bundle = join(scratch, 'DeepSeek Harness.app')
      const bundled = join(bundle, 'Contents', 'MacOS')
      mkdirSync(join(bundle, 'Contents', 'Resources', 'app.asar'), { recursive: true })
      mkdirSync(bundled, { recursive: true })
      assert.equal(
        resolveInstallationRoot(join(bundled, 'DeepSeek Harness'), []),
        bundle,
        'inside a macOS bundle the bundle is the installation, not Contents/MacOS',
      )

      const checkout = join(scratch, 'checkout')
      const cliDir = join(checkout, 'apps', 'cli')
      mkdirSync(join(cliDir, 'lib'), { recursive: true })
      writeFileSync(join(checkout, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n')
      writeFileSync(join(checkout, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-root' }))
      writeFileSync(join(cliDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '9.9.9' }))
      writeFileSync(join(cliDir, 'lib', 'bin.js'), '')
      assert.equal(
        resolveInstallationRoot('/usr/bin/node', [process.execPath, join(cliDir, 'lib', 'bin.js')]),
        checkout,
        'a source run prints the checkout root, not apps/cli',
      )

      const published = join(scratch, 'published', 'node_modules', '@deepseek-ai', 'dsh')
      mkdirSync(join(published, 'lib'), { recursive: true })
      writeFileSync(join(published, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '9.9.9' }))
      writeFileSync(join(published, 'lib', 'bin.js'), '')
      assert.equal(
        resolveInstallationRoot('/usr/bin/node', [process.execPath, join(published, 'lib', 'bin.js')]),
        published,
        'a published install has no workspace above it, so the package directory is the root',
      )
      assert.equal(resolveInstallationRoot('/usr/bin/node', []), undefined, 'nothing to name without a script')
      console.log('✓ the Directory fact resolves the installation root for every deployment')
    }

    // 7b. The banner follows the professional CLI conventions: identity line,
    //     one `Key: value` block with a single space after each colon, the note
    //     that qualifies the commands, then the commands. Groups are separated by
    //     one blank line. `DSH home` is the directory that holds every profile,
    //     `Directory` is where the running DSH lives. The profile directory gets no
    //     line: it is `DSH home` + `profiles` + `Profile`.
    const installRoot = join(scratch, 'install')
    const banner = { profileDirectory: profileDir, applicationDirectory: installRoot, home: homeDir, profile: 'web', hostPid: 4242, product: 'DeepSeek Harness', version: '0.2.1-rc.2' }
    const windows = bannerLines(banner, 'win32')
    assert.deepEqual(windows, [
      'DeepSeek Harness 0.2.1-rc.2',
      'Profile: web',
      `DSH home: ${homeDir}`,
      `Directory: ${installRoot}`,
      'Host pid: 4242 (End task: taskkill /PID 4242 /F)',
      '',
      'Plugin commands without --profile modify the web profile',
      '',
      'Commands:',
      '  dsh --dump-config',
      '  dsh plugin add <third-party-plugin>',
      '  dsh plugin remove <third-party-plugin>',
      '  dsh plugin update',
    ])
    // The stop command is a fact about the pid, so it sits on the pid line in
    // parentheses — and it is a command that exists: `quit <product>` was not.
    assert.equal(bannerLines(banner, 'linux')[4], 'Host pid: 4242 (End task: kill 4242)')
    assert.equal(windows.some((line) => line.startsWith('Stop this Host:')), false, 'no invented stop line')
    assert.ok(
      windows.some((line) => line.includes(homeDir)),
      'the DSH home is printed: it is where the profiles live',
    )
    assert.ok(
      windows.some((line) => line.includes(installRoot)),
      'the Directory fact is printed: it is where the running DSH lives',
    )
    assert.equal(
      windows.some((line) => line.includes(profileDir)),
      false,
      'the profile directory gets no line: the home and the profile name already name it',
    )
    // Without a home there is no line for it, rather than a line with an empty value.
    const withoutHome = bannerLines({ ...banner, home: undefined }, 'win32')
    assert.equal(withoutHome.length, windows.length - 1, 'the home line is omitted, not blanked')
    assert.equal(withoutHome.some((line) => line.includes('DSH home')), false, 'no DSH home line without a home')
    // The home is read off the profile directory when the Host does not publish one.
    assert.equal(homeOfProfile(join(homeDir, 'profiles', 'web')), homeDir, 'the home is the second parent of a profile directory')
    assert.equal(homeOfProfile(profileDir), undefined, 'a directory outside profiles/ names no home')
    // The command list is data, so it carries no layout: the two-space indent is
    // the banner's business, applied when it prints under `Commands:`.
    assert.deepEqual(profileCommands(), [
      'dsh --dump-config',
      'dsh plugin add <third-party-plugin>',
      'dsh plugin remove <third-party-plugin>',
      'dsh plugin update',
    ])
    // One space after each colon, no column alignment: every fact line is exactly
    // `key + ' ' + value`, so the value column follows the key length.
    const factKeys = ['Profile:', 'DSH home:', 'Directory:', 'Host pid:']
    for (const [index, key] of factKeys.entries()) {
      const line = windows[index + 1]
      assert.ok(line.startsWith(`${key} `), `${key} is followed by exactly one space`)
      assert.equal(line.slice(key.length + 1).includes('  '), false, 'no run of spaces inside a fact line')
    }
    assert.equal(windows[0].includes('terminal'), false, 'the title line is the product identity, not a generic name')
    const blanks = windows.map((line, index) => (line === '' ? index : -1)).filter((index) => index >= 0)
    assert.deepEqual(blanks, [5, 7], 'groups are separated by exactly one blank line')

    // 7b'. A terminal whose `dsh` cannot be shimmed still prints the commands:
    //      the banner documents the installation, not this plugin's workaround.
    assert.ok(bannerLines({ ...banner, profile: 'desktop' }, 'linux').includes('  dsh plugin add <third-party-plugin>'))

    // 7c. Identity: a packaged install names itself from its resources manifest,
    //     while a source run has none, so the version comes from the CLI package
    //     above the script Node was started with. A wrapper manifest in between
    //     is not the product, and without a script nothing is claimed.
    {
      const { resolveIdentity } = await import('../src/terminal/index.ts')
      const cliRoot = join(scratch, 'checkout', 'apps', 'cli')
      mkdirSync(join(cliRoot, 'lib'), { recursive: true })
      writeFileSync(join(cliRoot, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '9.9.9' }))
      writeFileSync(join(cliRoot, 'lib', 'bin.js'), '')
      assert.deepEqual(
        resolveIdentity('/usr/bin/node', [process.execPath, join(cliRoot, 'lib', 'bin.js')]),
        { product: 'DeepSeek Harness', version: '9.9.9' },
        'a source run names itself from the CLI package',
      )
      const wrapper = join(scratch, 'wrapper')
      mkdirSync(wrapper, { recursive: true })
      writeFileSync(join(wrapper, 'package.json'), JSON.stringify({ name: 'some-wrapper', version: '1.0.0' }))
      writeFileSync(join(wrapper, 'bin.js'), '')
      assert.equal(
        resolveIdentity('/usr/bin/node', [process.execPath, join(wrapper, 'bin.js')]),
        undefined,
        'a wrapper manifest is not the product identity',
      )
      assert.equal(resolveIdentity('/usr/bin/node', []), undefined, 'without a script there is no identity to print')
    }

    // 7b''. The shim injects --profile only for `plugin`, leaves other invocations
    //       alone, and the generated environment drops the Electron node marker.
    {
      const { prepareTerminalShim, terminalEnvironment } = await import('../src/terminal/index.ts')
      const deployment = { executable: process.execPath, bootstrap: join(scratch, 'cli.js'), product: 'DeepSeek Harness' }
      const shim = prepareTerminalShim(deployment, 'desktop', scratch)
      // The carrier script sits in the PATH directory next to the launcher that
      // calls it, so a terminal user sees one directory instead of two.
      const script = readFileSync(join(shim.directory, 'dsh.cjs'), 'utf8')
      assert.match(script, /args\[0\] === 'plugin'/u, 'the shim only rewrites plugin invocations')
      assert.match(script, /--expose-internals/u, 'the shim forwards to the carrier CLI')
      assert.match(script, /ELECTRON_RUN_AS_NODE: '1'/u)
      const childEnvironment = terminalEnvironment({ ...process.env, ELECTRON_RUN_AS_NODE: '1' }, { home: homeDir, shim })
      assert.equal(childEnvironment.ELECTRON_RUN_AS_NODE, undefined, 'the shell must not inherit node mode')
      assert.equal(childEnvironment.DSH_HOME, homeDir)
      assert.ok(childEnvironment.PATH.startsWith(shim.directory), 'the shim directory comes first on PATH')
    }
    // 7c. Windows: a PowerShell script opened through `cmd /c start`, so the new
    //     console gets its own window even when the Host has none.
    const winPlan = terminalPlan(banner, 'win32', { ComSpec: 'C:\Windows\system32\cmd.exe', SystemRoot: 'C:\Windows' }, scratch)
    assert.ok(!('error' in winPlan), 'windows has a plan')
    assert.equal(winPlan.plan.file, 'C:\Windows\system32\cmd.exe')
    assert.deepEqual(winPlan.plan.args.slice(0, 5), ['/d', '/c', 'start', '', winPlan.plan.args[4]])
    assert.ok(winPlan.plan.args.includes('-NoExit'), 'the window stays open')
    assert.ok(winPlan.plan.args.includes('-File'))
    assert.equal(winPlan.plan.hideWindow, false, 'a terminal must be visible')
    const scriptFile = winPlan.plan.args.at(-1)
    assert.ok(existsSync(scriptFile), 'the PowerShell script is written')
    const script = readFileSync(scriptFile, 'utf8')
    assert.match(script, /Host pid: 4242/u)
    assert.ok(script.includes(`Directory: ${installRoot}`), 'the window prints where the DSH lives')
    assert.ok(script.includes(`DSH home: ${homeDir}`), 'the window prints the home the profiles live in')
    assert.ok(
      script.includes(`Set-Location -LiteralPath '${profileDir}'`),
      'the shell starts in the profile directory, not in the installation',
    )
    assert.equal(winPlan.plan.cwd, profileDir, 'the child process starts in the profile directory')
    assert.match(script, /taskkill \/PID 4242 \/F/u)
    console.log('✓ the Windows plan opens a PowerShell window in the profile directory and prints the installation')

    // 7d. macOS: Terminal.app runs a `.command` script that stays in a login shell.
    const macPlan = terminalPlan(banner, 'darwin', {}, scratch)
    assert.ok(!('error' in macPlan), 'darwin has a plan')
    assert.equal(macPlan.plan.file, '/usr/bin/open')
    assert.deepEqual(macPlan.plan.args.slice(0, 2), ['-a', 'Terminal'])
    const command = readFileSync(macPlan.plan.args.at(-1), 'utf8')
    assert.match(command, /^#!\/bin\/bash/u)
    assert.match(command, /exec bash -l/u)
    assert.equal(macPlan.plan.cwd, profileDir, 'the macOS shell starts in the profile directory too')
    console.log('✓ the macOS plan hands Terminal.app a script that keeps a login shell')

    // 7e. Other platforms: the first emulator on PATH, or a message when there is none.
    const fakeBin = join(scratch, 'bin')
    mkdirSync(fakeBin)
    writeFileSync(join(fakeBin, 'xterm'), '')
    const linuxPlan = terminalPlan(banner, 'linux', { PATH: fakeBin }, scratch)
    assert.ok(!('error' in linuxPlan), 'a terminal emulator on PATH is used')
    assert.equal(linuxPlan.plan.file, 'xterm')
    assert.equal(linuxPlan.plan.args[0], '-e')
    assert.equal(linuxPlan.plan.cwd, profileDir, 'the Linux shell starts in the profile directory too')
    assert.ok(existsSync(linuxPlan.plan.args.at(-1)), 'the emulator runs the generated script')
    const noTerminal = terminalPlan(banner, 'linux', { PATH: '' }, scratch)
    assert.ok('error' in noTerminal, 'no emulator is an error, not a crash')
    assert.match(noTerminal.error, /no terminal program found/u)
    assert.equal(noTerminal.failure, 'no-terminal')
    assert.deepEqual(noTerminal.tried, LINUX_TERMINALS.map((candidate) => candidate.file))

    const failed = await openTerminal(ctxWith({}), { PATH: '' }, 'linux', scratch)
    assert.equal(failed.ok, false, 'openTerminal reports the failure instead of throwing')
    assert.match(failed.error, /no terminal program found/u)
    assert.equal(failed.failure, 'no-terminal', 'the client can tell this case apart')
    assert.equal(failed.tried.length, LINUX_TERMINALS.length, 'the failure names every launcher it tried')
    console.log('✓ the Linux plan picks the first installed emulator and reports when there is none')
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

console.log('')
console.log('all plan checks passed')
