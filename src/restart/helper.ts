import { spawn } from 'node:child_process'
import { dirname } from 'node:path'

import { type HelperPlan, HELPER_PLAN_VERSION, type LaunchSpec } from '../shared/helper-plan.ts'
import { writeDiagnostic } from '../diag.ts'
import { nodeExecutable } from './launch.ts'

/**
 * The detached watchdog.
 *
 * The Host cannot restart itself: the moment it exits, nothing is left to start
 * the replacement. So the Host spawns one helper *detached* (its own process
 * group / DETACHED_PROCESS, `stdio: 'ignore'`, `unref()`), hands it a plain-data
 * plan, and then asks itself to exit. The helper outlives it and:
 *
 * 1. waits `startDelayMs` so the HTTP answer reaches the page;
 * 2. tears the old processes down (SIGTERM, then SIGKILL after `waitTimeoutMs`);
 * 3. waits for the loopback port to be *released* — starting earlier loses the
 *    race with the old listener and the replacement dies with `EADDRINUSE`;
 * 4. starts the replacement and verifies it (port bound for a command-line Host,
 *    process still alive for the desktop application);
 * 5. appends every stage to the shared log file, so a failed restart is
 *    diagnosable from the file path shown in the UI.
 *
 * The helper source is generated as a string and run with `node -e`, so it needs
 * no module resolution of its own: it only uses Node built-ins. That also means
 * it cannot rot with the plugin's build output.
 */

/** Stage prefixes written by the helper; the Host mirrors them in its own log. */
export const HELPER_TAG = 'restart helper'

/**
 * How long a relaunched desktop application must stay alive before the restart
 * counts as successful. Longer would delay the log verdict for no extra signal;
 * shorter would report success for an application that dies on startup.
 */
const DESKTOP_SETTLE_MS = 4000

/**
 * Render the helper program.
 *
 * Written as ES5-era JavaScript with no template literals and no `${}` in the
 * generated text, because the whole program is embedded in a TypeScript template
 * literal and is executed by `node -e`.
 *
 * @param plan - the watchdog plan, inlined as JSON.
 * @returns the program source.
 */
export function helperSource(plan: HelperPlan): string {
  const json = JSON.stringify(plan)
  return `"use strict";
const fs = require("node:fs");
const net = require("node:net");
const cp = require("node:child_process");
const plan = ${json};
if (plan.version !== HELPER_PLAN_VERSION_PLACEHOLDER) {
  try { fs.appendFileSync(plan.logFile, "helper: unsupported plan version\\n"); } catch {}
  process.exit(2);
}
const log = (message) => {
  try {
    fs.appendFileSync(plan.logFile, "[" + new Date().toISOString() + "] [${HELPER_TAG}:" + process.pid + "] " + message + "\\n");
  } catch {}
};
// A *referenced* timer: the helper must outlive the Host, so nothing here may
// let the event loop drain while a stage is still pending.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const alive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; }
};
const waitGone = async (pid, timeout) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (!alive(pid)) return true;
    await sleep(200);
  }
  return !alive(pid);
};
const terminate = async (pid, label, timeout) => {
  if (!alive(pid)) { log(label + " " + pid + " already gone"); return true; }
  log("terminating " + label + " " + pid);
  try { process.kill(pid, "SIGTERM"); } catch (error) { log("SIGTERM " + label + " failed: " + error.message); }
  if (await waitGone(pid, timeout)) { log(label + " " + pid + " exited"); return true; }
  log(label + " " + pid + " ignored SIGTERM; killing");
  try { process.kill(pid, "SIGKILL"); } catch (error) { log("SIGKILL " + label + " failed: " + error.message); }
  const gone = await waitGone(pid, 5000);
  log(label + " " + pid + (gone ? " exited after SIGKILL" : " survived SIGKILL"));
  return gone;
};
const portState = (host, port) => new Promise((resolve) => {
  const socket = net.connect({ host, port });
  let settled = false;
  const done = (state) => {
    if (settled) return;
    settled = true;
    socket.destroy();
    resolve(state);
  };
  socket.setTimeout(700);
  socket.once("connect", () => done("open"));
  socket.once("timeout", () => done("unknown"));
  socket.once("error", (error) => done(error.code === "ECONNREFUSED" || error.code === "EHOSTUNREACH" ? "closed" : "unknown"));
});
const waitPortFree = async (host, port, timeout) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const state = await portState(host, port);
    if (state === "closed") return true;
    await sleep(250);
  }
  return (await portState(host, port)) === "closed";
};
const waitPortBound = async (host, port, timeout) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if ((await portState(host, port)) === "open") return true;
    await sleep(300);
  }
  return false;
};
const spawnReplacement = () => {
  const spec = plan.launch;
  const env = Object.assign({}, process.env);
  if (Array.isArray(spec.unsetEnv)) for (const name of spec.unsetEnv) delete env[name];
  let file = spec.file;
  let args = spec.args.slice();
  let shell = false;
  if (plan.platform === "win32" && spec.viaShell === true) {
    // A .cmd shim cannot be spawned directly. PowerShell runs it without a
    // visible console, and calling the shim (not the .ps1) avoids a
    // Restricted ExecutionPolicy.
    if (!/\\.(?:cmd|bat)$/i.test(file)) file = file + ".cmd";
    const quote = (value) => "'" + value.replace(/'/g, "''") + "'";
    args = ["-NoProfile", "-WindowStyle", "Hidden", "-Command", "& " + quote(file) + args.map((arg) => " " + quote(arg)).join("")];
    file = "powershell.exe";
    shell = false;
  }
  let out = "ignore";
  try { out = fs.openSync(plan.logFile, "a"); } catch {}
  log("spawning " + spec.file + " " + spec.args.join(" "));
  // windowsHide=true is STARTF_USESHOWWINDOW/SW_HIDE on Windows; the Electron
  // application inherits that show state for its first window and comes up
  // tray-only. A desktop relaunch therefore asks for a visible start.
  const child = cp.spawn(file, args, {
    cwd: spec.cwd || undefined,
    env,
    detached: true,
    shell,
    windowsHide: spec.hideWindow === false ? false : true,
    stdio: ["ignore", out, out],
  });
  child.once("error", (error) => log("replacement spawn error: " + error.message));
  child.once("exit", (code, signal) => log("replacement exited early: code=" + code + " signal=" + signal));
  child.unref();
  return child;
};
const main = async () => {
  log("plan v" + plan.version + " target=" + plan.target + " host=" + plan.hostPid + " shell=" + (plan.shellPid || "-") + " port=" + (plan.port === undefined ? "-" : plan.port));
  await sleep(plan.startDelayMs);
  if (plan.target === "desktop") {
    // Terminate the shell first: an application started while the old instance
    // still holds the single-instance lock would only focus its window and exit.
    if (plan.shellPid !== undefined) await terminate(plan.shellPid, "shell", plan.waitTimeoutMs);
    await terminate(plan.hostPid, "host", plan.waitTimeoutMs);
    if (!(await waitGone(plan.shellPid || 0, 5000))) log("warning: shell still alive before relaunch");
    await sleep(400);
    const child = spawnReplacement();
    if (!Number.isInteger(child.pid)) { log("result=failed: no pid"); process.exit(1); }
    // The application cannot "bind a port" the watchdog knows about, and its
    // own single-instance lock decides whether the window actually appears, so
    // the only honest check is that the process survives its startup window.
    const settle = Math.min(plan.settleTimeoutMs, ${String(DESKTOP_SETTLE_MS)});
    const deadline = Date.now() + settle;
    while (Date.now() < deadline) {
      await sleep(500);
      if (!alive(child.pid)) { log("result=failed: application exited during its first " + settle + "ms"); process.exit(1); }
    }
    log("result=ok: application running for " + settle + "ms, pid=" + child.pid);
    process.exit(0);
  }
  await terminate(plan.hostPid, "host", plan.waitTimeoutMs);
  if (plan.port !== undefined) {
    log("waiting for port " + plan.host + ":" + plan.port + " to be released");
    if (!(await waitPortFree(plan.host || "127.0.0.1", plan.port, plan.waitTimeoutMs))) {
      log("result=failed: port " + plan.port + " still listening");
      process.exit(1);
    }
    log("port " + plan.port + " released");
    await sleep(300);
  } else {
    await sleep(1000);
  }
  const child = spawnReplacement();
  if (!Number.isInteger(child.pid)) { log("result=failed: no pid"); process.exit(1); }
  log("replacement pid=" + child.pid + "; " + (plan.platform === "win32" ? "stop with: taskkill /PID " + child.pid + " /F" : "stop with: kill " + child.pid));
  if (plan.port === undefined) {
    await sleep(2000);
    log(alive(child.pid) ? "result=ok: replacement running pid=" + child.pid : "result=failed: replacement exited");
    process.exit(0);
  }
  const bound = await waitPortBound(plan.host || "127.0.0.1", plan.port, plan.settleTimeoutMs);
  if (!bound) { log("result=failed: replacement pid=" + child.pid + " never bound port " + plan.port + "; its startup line above records the origin it did bind"); process.exit(1); }
  log("result=ok: replacement bound port " + plan.port + " pid=" + child.pid);
  process.exit(0);
};
main().catch((error) => {
  log("result=failed: " + (error && error.message ? error.message : String(error)));
  process.exit(1);
});
`.replace('HELPER_PLAN_VERSION_PLACEHOLDER', String(HELPER_PLAN_VERSION))
}

/** Handle returned to the caller so it can log the helper pid. */
export interface HelperHandle {
  readonly pid: number | undefined
}

/**
 * Spawn the watchdog for one plan.
 *
 * Runs the *current* executable in its current mode: a command-line Host runs
 * real Node, while the official desktop Host is the application executable in
 * Electron node mode, which is reused as-is (it accepts `-e`).
 *
 * @param plan - what the watchdog must do.
 * @returns the helper pid when the spawn produced one.
 */
export function startHelper(plan: HelperPlan): HelperHandle {
  const executable = nodeExecutable()
  const source = helperSource(plan)
  writeDiagnostic(`${HELPER_TAG}: arming ${plan.target} restart via ${executable}`)
  const child = spawn(executable, ['-e', source], {
    cwd: plan.launch.cwd ?? dirname(executable),
    // Keep the environment: Electron node mode needs `ELECTRON_RUN_AS_NODE`,
    // and the replacement inherits it explicitly through `unsetEnv`.
    env: process.env,
    detached: true,
    // No pipes: the Host is about to exit, and a piped stdio would tie the
    // helper's lifetime to it.
    stdio: 'ignore',
    windowsHide: true,
  })
  child.once('error', error => { writeDiagnostic(`${HELPER_TAG}: spawn failed: ${error.message}`) })
  child.unref()
  return { pid: child.pid }
}

/** Re-exported so callers can build a plan without another import. */
export type { HelperPlan, LaunchSpec }
