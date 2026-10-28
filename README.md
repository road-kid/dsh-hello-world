---
description: "DeepSeek Harness Starter Pack: Adds a restart button to the settings header, directly right of the Open DSH terminal button, and registers /restart: one plugin, two independently switchable components."
kind: "package-bundle"
---

# dsh-hello-world

English | [中文](README.zh.md)

## Overview

One plugin, two components:

- **quick-restart** — a restart button in the settings header, plus the typed `/restart` command. It registers in the same official `settings.action` seat the terminal uses, so both actions share the header and sit before Close; a shell that renders no settings header shows no restart button, and `/restart` stays available.
- **quick-terminal** — an “Open DSH terminal” button in the settings header that opens the same shell as the terminal bundled with the desktop app.

Both are listed under the single `dsh-hello-world` card in the plugin manager, each with its own switch: keep the restart button only, the terminal only, or switch both off. A command-line Host restarts in place; the official desktop app relaunches itself and the new Host starts under it. The page reconnects on its own and only offers a refresh fallback when no new Host answers.

Install it into a profile:

```text
dsh plugin --profile <name> add <path to this package>
```

## Contents

- [Use this package](#use-this-package)
- [Options](#options)
- [Understand the implementation](#understand-the-implementation)
- [Further exploration](#further-exploration)
- [Model experience](#model-experience)
- [Known limitations](#known-limitations-and-deferred-work)
- [Dev note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

### Install into a profile

```text
dsh plugin --profile <name> add <path to this package>
dsh plugin --profile <name> remove dsh-hello-world
```

The manifest declares `dsh.bundle.patch`, so the reconcile step activates this package as a profile layer. `cordis.patch.yml` inserts two rows: `quick-restart` and `quick-terminal`. Both rows name component packages by bare specifier, so the loader resolves them against the profile's package resolution table — not from this package's directory. That is why both components are also declared in this package's `dependencies` (as `file:` directories, linked under `node_modules` when the package is built): the table's profile scope is the dependency closure of every profile layer, so an undeclared component is invisible to the loader and its row fails to import with `ERR_MODULE_NOT_FOUND`, taking that button down with it. Declared this way, the plugin manager shows one `dsh-hello-world` card with two separately titled and described components underneath. Bundled profiles enable HMR, so a running profile recomposes in place; startup-only profiles pick the layer up on the next launch.

### What you get

**The restart button (quick-restart).** It appears at the right end of the settings header, directly right of “Open DSH terminal” and before Close. Clicking it opens a confirmation dialog — `Restart the current DSH and run a new DSH instance automatically.` — that names the tasks it will interrupt when any are running, prints the exact command line the next Host will run, and points at the diagnostic log that records every restart stage. Typing `/restart` restarts without the dialog; `/restart --force` ignores running tasks but not the other refusals.

The settings header exposes an official seat: `settings.action`. The plugin registers into it and the shell lays out every action in one row before Close, so the restart button needs no DOM insertion, no animation-frame re-placement and no reading of the header's layout — the seat's `order` (110) simply sorts it to the right of the terminal action (100). The button renders from the same local primitives the terminal action uses, and every control is this plugin's own markup.

The button is unavailable when the plugin is disabled, the process is managed by a supervisor (unless `allowSupervisor`), a debugger is attached, a restart is already in flight, or `refuseWhileBusy` is on and tasks are running. The reason replaces the button's label; the button is rendered `aria-disabled` instead of `disabled`, so it stays focusable and a screen reader still announces why it cannot be pressed.

A restart terminates the Host that accepted the request. The client remembers the pid it asked to replace and re-reads the status route every 2 seconds; the first answer carrying a different pid is the new Host, and the page keeps its connection. After 25 seconds without a new Host the button offers a page refresh instead.

**The terminal button (quick-terminal).** The settings header shows “Open DSH terminal”, with the restart button (when that component is on) to its right and Close last. It opens the same shell as the terminal bundled with the official desktop app — starting in the profile directory, the one `dsh plugin --profile <name>` acts on — and prints the same welcome text plus this Host's pid:

```text
DeepSeek Harness 0.2.1-rc.2
Profile: desktop
DSH home: C:\Users\you\.dsh
Directory: C:\Program Files\DeepSeek Harness
Host pid: 48213 (End task: taskkill /PID 48213 /F)

Plugin commands without --profile modify the desktop profile

Commands:
  dsh --dump-config
  dsh plugin add <third-party-plugin>
  dsh plugin remove <third-party-plugin>
  dsh plugin update
```

The layout is identity → facts → note → commands: the app and version, a `key: value` fact block with a single space after the colon, the sentence that qualifies the commands, then the four commands under `Commands:`. Each fact answers a question the others do not: `Profile:` is which profile the shell's `dsh` edits, `DSH home:` is the directory that holds every profile, `Directory:` is where the running DSH itself lives — the installation directory of a packaged app (`C:\Program Files\DeepSeek Harness`, the `.app` bundle on macOS), the checkout root when `dsh web` was started from a working copy, or the `@deepseek-ai/dsh` package directory of a published install — and `Host pid:` is which process to stop. The profile directory gets no line of its own: it is `DSH home` + `profiles` + `Profile`, so a line for it would restate the three around it — the shell still starts there, because that is where `dsh plugin` work happens. The note about `--profile` sits immediately before the command list it qualifies, because it is a condition on those commands. The command that stops this Host sits in parentheses after its pid, because it is a fact about that pid, and it is spelled out as what it does followed by the command to type — `End task: taskkill /PID <pid> /F` on Windows, `End task: kill <pid>` elsewhere — so the reader does not have to recognise the tool to know what the part in parentheses is for, and the command is one the shell will actually accept. That is how Vite, Poetry and uvicorn print — no ASCII art, no boxes, exactly one blank line between groups. The identity line is resolved from whichever way the Host runs: a packaged app reads the product manifest it ships next to its resources, and falls back to the `@deepseek-ai/dsh` CLI package above the script Node was started with — the same walk a source checkout (`dsh web`) uses — so both print `DeepSeek Harness <version>` instead of a bare `DSH`. That line reads the same on both deployments because it is the same command: a command-line Host is the process you started, and a desktop Host is a child of the app, so signalling the pid ends the Host in either case. A desktop app starts another Host when its child exits, which is why the fact says "Host pid" and not "quit the app".

The shell is not a child of the Host, so Ctrl+C inside it never reaches the Host. Before the window opens, a packaged install writes a private shim directory and puts the launcher on `PATH`: `dsh.cmd` for cmd and PowerShell on Windows, a `dsh` script elsewhere. Only that launcher sits on `PATH`; everything else the terminal needs stays in the private root above it. The shim forwards to the deployment's own desktop CLI — the one the app uses — fills in `--profile` for `plugin` when it is missing, and strips the Electron handoff variables from the shell environment. So `dsh plugin add <third-party-plugin>` in that terminal installs into this profile exactly as it does in the app's own terminal. A source checkout has no carrier CLI to forward to, so no shim is written there and the banner prints the commands unchanged. The welcome script lives in that private root under a fixed name, overwritten on each open, instead of leaving one file per open in the system temp directory; leftovers from older versions (`dsh-hello-world-terminal-*.ps1`/`.command`/`.sh`) are removed when a window opens. Two things outlive a window: the diagnostic log at `%TEMP%\dsh-hello-world.log`, rotated to `.1` past 512 KiB (one generation is kept), and the shim directory itself — one per profile and install, named after the profile with a short digest, rewritten on every open.

One command still cannot act on the `desktop` profile: the launcher reserves it for the app, so `dsh --dump-config` reports that instead of printing configuration. The line is listed to mirror the official terminal.

**Components switch independently.** The plugin manager lists `quick-restart` and `quick-terminal` under “Components”, each with its own switch. A switched-off component is not loaded at all: its host routes disappear and its client bundle unloads with the button — with the terminal component off, the settings header shows no terminal button; with the restart component off, the settings header shows no restart button. Switching either back on restores it, and neither needs a page refresh.

**Two switches, two meanings.** The component switch is the lifecycle gate: it unloads the routes and the bundle. The `enabled` option is a policy gate: it keeps the capability mounted and refusing, so the button can name the reason instead of vanishing — a capability that cannot be queried cannot explain itself.

-----

<a id="options"></a>
## Options

Set these keys in the `config` block of the `quick-restart` row in the profile patch. The component ships no form of its own; the plugin manager renders one from this schema, which is also why every key is a live setting — a change applies without a restart. The terminal component has no options.

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Policy switch; refuses with `disabled` while the button explains it (the component switch unmounts) |
| `confirmBeforeRestart` | `true` | Ask before restarting |
| `refuseWhileBusy` | `false` | Refuse while agents or tasks are running |
| `allowSupervisor` | `false` | Allow a restart under a process supervisor |
| `delayMs` | `250` | Delay between the answer and the exit |
| `waitTimeoutMs` | `30000` | How long the watchdog waits for the old process and port |
| `settleTimeoutMs` | `30000` | How long the watchdog waits for the replacement to start |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation details — click to expand</summary>

This package is a bundle: it carries no runtime entry of its own, only a `cordis.patch.yml` that inserts two component rows. Each component is a complete package under `packages/dsh-quick-restart` and `packages/dsh-quick-terminal`, declared in this package's `dependencies` as a `file:` directory and linked under `node_modules` by `npm run build`. Both halves of that pairing matter: Node finds the code through the link, and the profile layer's dependency closure finds the package only because the declaration exists — a row specifier is a bare package name resolved against the profile's resolution table, never from this package's own directory. They are not profile-level dependencies, so they never become cards of their own in the plugin manager. Component titles and descriptions come from each package's `locale/*.json` `meta` block, which is what lets one card list two differently titled components.

The `quick-restart` row owns capability detection and the restart itself. The Host decides whether a restart is allowed and starts a detached `node -e` watchdog. The watchdog waits for the old process to exit and the port to free, then starts the replacement: it replays the Host's command line, or relaunches `DeepSeek Harness.exe --updated` under the desktop app. A command line that asked for `--port 0` is replayed with the port this Host actually bound, and a web launch gains `--no-open`.

The client half is two bundles, each loaded and unloaded with its own component. Both register a single entry in the same `settings.action` seat: the terminal's `open-terminal` at order 100 and the restart's `restart` at order 110, so they share the header row before Close and the restart sits to the right. Registrations, the shared stylesheet and the locale dictionaries all live in `ctx.effect` and are removed when a component unloads. There is one stylesheet — the primitives both components render, reference-counted on the document so the first bundle to unload does not strip the sheet the other still uses. Every control is this plugin's own markup colored with `--dsw-alias-*` theme tokens; the icons are a copy of the shipped artwork kept under the plugin's own prefix, because a plugin must not load the UI-primitives package at runtime.

Four routes carry the browser half, all under `/api/dsh-hello-world/`: `status`, `restart`, `terminal/open` and `terminal/status`. Each answers HTTP 200 with an `ok` flag so refusals stay readable, and the executing routes re-check the request origin before acting.

</details>

-----

<a id="further-exploration"></a>
## Further exploration

- `@deepseek-ai/dsh-plugin-manager` — the `dsh plugin` install and reconcile path that activates this layer, and how the component list is built.
- `@deepseek-ai/dsh-client-modules` — how a component package's `dsh.client` entry becomes a browser module.
- `@deepseek-ai/dsh-client-ui-settings-general` — the owner of the settings pane whose header renders the `settings.action` seat both components register into.

-----

<a id="model-experience"></a>
## Model experience

None: the restart button, the terminal button and `/restart` all run on the UI command surface; sessions they interrupt own every model-visible effect.

### KV cache impact

No request content is produced. A restart ends the Host that holds the cached prefix, so the next session rebuilds that prefix once.

-----

<a id="known-limitations-and-deferred-work"></a>
## Known limitations

- A restart interrupts every running agent, queued turn and background task in the Host.
- By default the plugin refuses to restart when a process supervisor manages the process or a debugger is attached: neither deployment owns its own lifecycle.
- The restart and terminal buttons are header actions, not panes: the shell owns the settings header's layout, so the plugin controls only its `order` inside `settings.action`; a shell that renders no settings header shows neither button, and the `/restart` command still restarts.
- The buttons require the shipped settings header; a shell that renders none shows neither button, and the `/restart` command still restarts. The plugin still reports the capability as supported instead of failing to load.
- Component packages are embedded in this package's `node_modules` and declared in its `dependencies` as `file:` directories. Moving or renaming a component directory means updating that `file:` path (and reinstalling) as well as `npm run build`, which repoints the links; a component whose declaration is missing still builds, but its row then fails to import in the profile.
- Restarting from a terminal detaches the replacement: the terminal returns to its prompt and the new Host is not its child. The diagnostic log records the replacement pid.
- On Windows the replacement must not inherit `windowsHide`, or it would start as a tray-only process with no window; the watchdog clears that flag.
- Opening a terminal on Linux requires one of `x-terminal-emulator`, `gnome-terminal`, `konsole`, `xfce4-terminal`, `xterm` on `PATH`. The failure dialog lists them; adding another terminal means extending `LINUX_TERMINALS` and rebuilding.
- The confirmation dialog renders in place and escapes the pane's clip through `position: fixed`. If the shell gives an ancestor a `transform` or `filter`, the dialog is trapped inside that ancestor.

<a id="dev-note"></a>
### Dev note

<details>
<summary>Maintainer context — click to expand</summary>

```bash
npm install
npm run build
npm run verify
```

`build.mjs` produces five artifacts — `packages/dsh-quick-restart/lib/{index,client}.js`, `packages/dsh-quick-terminal/lib/{index,client}.js`, and the bundle's own `lib/index.js` — each with a source map, then refreshes the two `node_modules/dsh-quick-*` links. The client artifacts keep `react`, `react-dom` and `react/jsx-runtime` external: the shell's module table provides them, and every other control is local.

`npm run verify` runs `npm run check` first — the type check, then esbuild — and then four scripts. Building before verifying is not incidental: the client script loads the built `lib/client.js` the way the page does, so a stale artifact would be verified instead of the source that produced it. `verify:bundle` guards the wiring the Loader depends on: that every inserted row is a bare specifier, that the row is declared in `dependencies` as a `file:` directory, that Node reaches that directory through the `node_modules` link from this package's manifest, that the component ships its `./client` half, and that the version is the same in all four manifests. The other three cover the host half, the restart plan and the client halves.

```
package.json           bundle manifest: dsh.bundle.patch, no runtime entry of its own
cordis.patch.yml       inserts the quick-restart and quick-terminal rows
build.mjs              esbuild: both component packages' host and client halves
tsconfig.json          type-checking only; esbuild does the emitting
.editorconfig          two spaces, LF, UTF-8
locale/                the plugin card's own title and description
assets/icon.svg        the plugin icon
scripts/
  fixtures.mjs         one config default, shared by every script
  verify-bundle.mjs    the manifest, patch and version wiring
  verify-host.mjs      the host half: routes, refusals, log rotation
  verify-plan.mjs      the restart plan on all three platforms
  verify-client.mjs    both client halves, against a stub DOM
packages/
  dsh-quick-restart/   component package: manifest, locale, icon, build output
  dsh-quick-terminal/  component package: manifest, locale, icon, build output
src/
  bundle.ts            the bundle's tiny entry, so the package resolves like any plugin
  index.ts             quick-restart host entry: routes and /restart
  config.ts            schemastery configuration
  diag.ts              diagnostic log, rotated at 512 KiB
  restart/
    index.ts           capability probe, plan, restart scheduling
    policy.ts          the ordered refusal rules, each carrying its own wording
    guards.ts          supervisor, debugger and request-origin detection
    activity.ts        counting the work a restart would interrupt
    launch.ts          how to relaunch: the desktop app or this command line
    helper.ts          the detached watchdog, generated as a `node -e` program
    routes.ts          /status and /restart
    command.ts         the /restart command
    types.ts           views local to the host half
  terminal/
    index.ts           openTerminal — the only place in this half with a side effect
    identity.ts        product/version resolution, desktop deployment lookup
    shim.ts            the private `dsh` launcher and the shell environment
    plan.ts            the three platform plans, welcome script, PATH lookup
    banner.ts          the banner's text and layout
    entry.ts           quick-terminal host entry: routes
    routes.ts          /terminal/open and /terminal/status
    client.tsx         the settings-header action
  client/
    index.ts           quick-restart client entry: settings.action seat, shared stylesheet, watch
    store.ts           capability snapshot, polling, restart recovery
    use-restart.tsx    the action hook: confirm, request, wait for the new Host
    entry-view.ts      one derivation of label/reason/disabled for the button
    restart-action.tsx the header button, rendered in settings.action
    api.ts             the four routes
    service.ts         optional-service lookup
    styles.ts          one shared stylesheet, reference-counted per document
    locales.ts         zh/en dictionaries
    types.ts           structural views of the runtime services
    ui/                the vendored primitives: dialog, toast, button, icon, focus
  shared/
    protocol.ts        routes, wire types, guards
    http.ts            route mounting through the connection service
    helper-plan.ts     the watchdog plan's shape
    mount.ts           one mount/unmount log line per component
```

</details>
