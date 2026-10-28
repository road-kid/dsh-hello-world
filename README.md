<img src="./assets/readme/hero.svg" width="100%" alt="dsh-hello-world — restart the Host and open a DSH terminal, both from the settings header">

**English** · [简体中文](./README.zh.md)

A small DeepSeek Harness bundle that adds two controls to the settings header: **Restart** and **Open DSH terminal**. One plugin, two components — each can be switched on or off independently in the plugin manager.

## What you get

- **Quick Restart** — a Restart button beside the other header actions, plus the `/restart` command. It restarts the running Host and reconnects the page.
- **Quick Terminal** — an **Open DSH terminal** button that launches a shell just like the one the desktop app opens, with a short banner naming the profile, directory and Host pid.

## How the two components fit

One bundle ships both packages. Quick Terminal registers at order `100` and Quick Restart at order `110`, so the header reads **Open DSH terminal**, then **Restart**, then Close.

<img src="./assets/readme/how-it-fits.svg" width="100%" alt="Diagram: one dsh-hello-world bundle contains Quick Restart (order 110) and Quick Terminal (order 100), which register into the settings header">

## Install

Add the package to a profile:

```bash
dsh plugin --profile <profile> add <this-package-directory>
```

Then open **Settings**. Both buttons appear at the top right of the header. To remove the bundle:

```bash
dsh plugin --profile <profile> remove dsh-hello-world
```

## Using it

### Restart

- Click **Restart**. A dialog says how many tasks will be interrupted before anything happens; confirm to restart.
- Typing `/restart` refuses while the Host has active work; `/restart --force` restarts anyway.
- The page reconnects to the new Host automatically once it is back. If nothing reports in within 25 seconds it offers a reload as a fallback.
- On the command line the Host restarts in place; in the desktop app the app restarts itself.

### Terminal

- Click **Open DSH terminal**. It opens your platform terminal in the deployment directory with `dsh` on `PATH` — the same environment the desktop app uses.
- The banner prints the profile, DSH home, working directory and Host pid (with the command that stops it).

## Options

The restart component reads these from its `config` block in the plugin manager; the terminal component has no options.

| Option | Default | What it does |
| --- | --- | --- |
| `enabled` | `true` | Allow this deployment to restart itself. Off keeps the button visible and explains why it refuses. |
| `confirmBeforeRestart` | `true` | Ask before restarting. A restart interrupts every running agent, queued turn and background job. |
| `refuseWhileBusy` | `false` | Refuse to restart while agents, queued turns or background jobs are running. |
| `allowSupervisor` | `false` | Allow a restart under systemd, launchd or pm2. A supervisor may kill or fight the replacement. |
| `delayMs` | `250` | Milliseconds between answering the request and leaving the process, so the answer reaches the page. |
| `waitTimeoutMs` | `30000` | Milliseconds the watchdog waits for the old processes and the port before forcing the issue. |
| `settleTimeoutMs` | `30000` | Milliseconds a replacement has to bind its port before the restart counts as failed. |

## Compatibility and limits

- Node.js ≥ 22.18 and DeepSeek Harness `>=0.2.1-rc.2 <0.3.0`.
- Restarting under a process supervisor is refused by default, because the supervisor may kill or fight the replacement.
- Licensed under the MIT License.
