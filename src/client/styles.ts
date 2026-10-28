/**
 * The plugin's stylesheets.
 *
 * Every rule here belongs to a control this plugin renders itself. The geometry
 * is copied from the host's own controls — the dialog, the button and the
 * banner — so the restart affordance is indistinguishable from an official one
 * instead of merely similar: same 36/28px button heights, same dialog padding and
 * radius, same banner surface. Class names are renamed under the `dh-` prefix so
 * the copies cannot collide with the host's stylesheet.
 *
 * Both client bundles render the same primitives — a settings-header button and
 * a dialog — so one shared stylesheet serves both. `installBaseStyles` installs
 * it, reference-counted on the document so either bundle can unload without
 * stripping the rules the other still renders with.
 *
 * Only theme tokens are used (`--dsw-alias-*`, `--dsw-radius-*`,
 * `--dsw-elevation-*`), so light, dark and high-contrast themes all follow the
 * shell without a plugin-side palette.
 */

/** Package id; also the `data-plugin` marker on both style elements. */
export const PLUGIN_ID = 'dsh-hello-world'

/**
 * Stylesheet id of the shared primitives.
 *
 * Both bundles install this one, so the id has to be the same in both — that is
 * what lets the second bundle reuse the first one's element instead of adding a
 * duplicate copy of the same rules.
 */
export const BASE_STYLE_ID = 'dsh-hello-world/ui.css'

/**
 * Reference count of {@link BASE_STYLE_ID} on the document.
 *
 * Module state cannot hold it: the two bundles are separate module instances in
 * the same page, so each would count only its own owner and the first unload
 * would remove the element the other bundle still renders with. The document is
 * the only object both instances share.
 */
const BASE_STYLE_COUNT = 'dshHelloWorldUiCss'

/**
 * The primitives: dialog, buttons, banner and the labelled dialog rows.
 *
 * Kept free of any restart-specific selector so the terminal bundle can install
 * it alone.
 */
const BASE_CSS = `
/*
 * Stacking order, in one place because a stylesheet has no constants.
 *
 * 1000 — the dialog layer. It has to cover every shell surface the plugin can be
 *        mounted from (panels, the settings header) without a portal.
 * 1100 — the banner. It reports the outcome of the action a dialog just started,
 *        so it must stay readable while that dialog is still open.
 *
 * Both are plugin-local: the shell keeps its own layers below them, and no other
 * plugin is expected to reuse these numbers.
 */
.dh-modal-root {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: max(24px, var(--dsh-frame-overlay-top, 24px)) 24px;
}

.dh-modal-root:focus {
  outline: none;
}

.dh-modal-mask {
  position: absolute;
  inset: var(--dsh-frame-chrome-top, 0px) 0 0;
  backdrop-filter: var(--dsw-mask-blur);
}

.dh-modal-mask::after {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--dsw-alias-bg-mask-1);
  animation: dh-modal-enter var(--ds-transition-duration) var(--ds-ease-in-out);
}

.dh-modal-dialog {
  box-sizing: border-box;
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 20px;
  width: min(380px, 100%);
  max-height: 100%;
  padding: 0 0 24px;
  overflow: hidden;
  border: 0;
  border-radius: var(--dsw-radius-panel, 28px);
  background: var(--dsw-alias-bg-layer-2);
  box-shadow: var(--dsw-elevation-prominent);
  animation: dh-modal-enter var(--ds-transition-duration) var(--ds-ease-in-out);
}

.dh-modal-dialog:focus {
  outline: none;
}

@keyframes dh-modal-enter {
  from { opacity: 0; }
  to { opacity: 1; }
}

.dh-modal-content {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-height: 0;
  overflow-y: auto;
}

.dh-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 22px 14px 12px 24px;
}

.dh-modal-title {
  margin: 0;
  font-size: 16px;
  line-height: 24px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
}

.dh-modal-close {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: var(--dsw-radius-sm, 8px);
  background: transparent;
  cursor: pointer;
  color: var(--dsw-alias-label-secondary);
}

.dh-modal-close:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dh-modal-description {
  margin: 0;
  padding: 0 24px;
  font-size: 14px;
  line-height: 22px;
  font-weight: 400;
  color: var(--dsw-alias-label-primary);
}

.dh-modal-body {
  display: flex;
  flex-direction: column;
  min-width: 0;
  margin-top: 20px;
  padding: 0 24px;
}

.dh-modal-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 0 24px;
}

/*
 * Buttons.
 *
 * The four variants map to the host's fill families and the two sizes to its
 * control heights; only tokens are referenced, so the dialog buttons sit beside
 * official ones without a plugin-side palette.
 */
.dh-button-base {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: none;
  border-radius: var(--dsw-radius-md, 12px);
  cursor: pointer;
  font-family: inherit;
  font-size: 14px;
  line-height: 22px;
  color: var(--dsw-alias-label-primary);
  background: transparent;
  padding: 0 14px;
}

/*
 * Two ways to say "not activatable": the native attribute, and aria-disabled for
 * controls that must stay focusable so their refusal reason is reachable from the
 * keyboard (a native "disabled" button also suppresses the tooltip that explains
 * it). Activation is ignored by the component's handler in the second case.
 */
.dh-button-base:disabled,
.dh-button-base[aria-disabled='true'] {
  cursor: not-allowed;
  opacity: 0.4;
}

.dh-button-md {
  height: 36px;
}

.dh-button-sm {
  height: 28px;
  font-size: 12px;
  line-height: 18px;
  padding: 0 10px;
  border-radius: var(--dsw-radius-sm, 8px);
}

.dh-button-primary {
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
}

.dh-button-primary:hover:not(:disabled) {
  background: var(--dsw-alias-button-primary-hover);
}

.dh-button-ghost:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dh-button-ghost:active:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-active);
}

.dh-button-outline {
  border: 0.5px solid var(--dsw-alias-border-l3);
  background: transparent;
}

.dh-button-outline:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dh-button-toolbar {
  background: var(--dsw-alias-button-tool-bar-fill);
}

.dh-button-toolbar:hover:not(:disabled) {
  background: var(--dsw-alias-button-tool-bar-hover);
}

/*
 * One focus treatment for every control in the stylesheet: an outline, not a
 * background change. A fill is only a contrast step away from the surrounding
 * surface, which disappears in high-contrast themes; an outline with
 * outline-offset: -2px stays inside the control's box so it cannot shift the
 * layout, and it is drawn over whatever fill the control already has.
 */
.dh-button-base:focus-visible {
  outline: 2px solid var(--dsw-alias-border-focus, var(--dsw-alias-label-primary));
  outline-offset: -2px;
}

/*
 * The transient banner.
 *
 * Fixed at the top centre, above the dialog layer so a failure reported from a
 * dialog stays readable. The box is click-through: only its action takes the
 * pointer. The hold comes from the component as --dh-toast-hold on every render
 * (there is no fallback here on purpose: the component owns the duration, and a
 * number in this file would be a second copy of it to keep in sync).
 */
.dh-toast {
  position: fixed;
  top: 40px;
  left: 50%;
  z-index: 1100;
  pointer-events: none;
  display: flex;
  align-items: center;
  gap: 10px;
  width: max-content;
  max-width: min(640px, calc(100vw - 48px));
  padding: 12px 16px;
  border-radius: var(--dsw-radius-lg, 16px);
  background: var(--dsw-alias-toast-bg);
  color: var(--dsw-alias-toast-label);
  font-size: 14px;
  line-height: 22px;
  box-shadow: var(--dsw-shadow-lv3);
  transform: translateX(-50%);
  animation:
    dh-toast-in 160ms ease-out,
    dh-toast-fade 1000ms ease var(--dh-toast-hold) forwards;
}

.dh-toast-text {
  min-width: 0;
}

.dh-toast-action {
  display: inline;
  padding: 0;
  border: 0;
  background: none;
  color: var(--dsw-static-deepseek-400);
  font: inherit;
  cursor: pointer;
  margin-inline: 3px;
  pointer-events: auto;
}

.dh-toast-action:hover {
  opacity: 0.8;
}

@keyframes dh-toast-in {
  from {
    opacity: 0;
    transform: translate(-50%, -6px);
  }

  to {
    opacity: 1;
    transform: translate(-50%, 0);
  }
}

@keyframes dh-toast-fade {
  to {
    opacity: 0;
    visibility: hidden;
  }
}

/*
 * One labelled fact in the dialog.
 *
 * The log path is a block of its own, so its label sits above it in a single
 * column: row spacing only, no column gap to reserve for a second column that
 * does not exist.
 */
.dh-dialog-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 2px;
  align-items: baseline;
}

.dh-dialog-label {
  color: var(--dsw-alias-label-tertiary);
  font-size: 13px;
  line-height: 20px;
}

.dh-dialog-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 20px;
}

/*
 * The interruption warning plus the running-task count.
 *
 * Both lines are one text block on purpose: pre-line renders the newline
 * between them without a paragraph gap, so the count reads as the second
 * sentence of the warning instead of a detached footnote.
 */
.dh-dialog-text {
  margin: 0;
  color: inherit;
  font-size: inherit;
  line-height: inherit;
  white-space: pre-line;
}

/*
 * A command line or a log path, as a padded block of its own.
 *
 * display: block keeps a wrapped path inside one padded box; as an inline span
 * its continuation lines lost the padding and started at the dialog edge.
 */
.dh-dialog-command {
  display: block;
  box-sizing: border-box;
  max-width: 100%;
  margin: 0;
  padding: 8px 10px;
  border-radius: var(--dsw-radius-sm, 8px);
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-primary);
  font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 12px;
  line-height: 18px;
  overflow-wrap: anywhere;
}

.dh-dialog-note {
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
}

@media (prefers-reduced-motion: reduce) {
  .dh-toast {
    animation: dh-toast-fade 1000ms ease var(--dh-toast-hold) forwards;
  }

  .dh-modal-mask::after,
  .dh-modal-dialog {
    animation: none;
  }
}
`

/**
 * Create a style element and append it to the document's head.
 *
 * @param doc - document to install into.
 * @param tagId - element id, also the handle for a later lookup.
 * @param css - rules to install.
 * @returns the new element.
 */
function createStyle(doc: Document, tagId: string, css: string): HTMLStyleElement {
  const element = doc.createElement('style')
  element.id = tagId
  element.dataset.plugin = PLUGIN_ID
  element.dataset.pluginCss = PLUGIN_ID
  element.textContent = css
  doc.head.append(element)
  return element
}

/**
 * Install a stylesheet with an owner count kept on the document.
 *
 * The count cannot live in a module variable: the two bundles are separate
 * module instances in the same page, and a bundle re-applied by the plugin
 * manager is a second owner of its own sheet. Counting on the document — the one
 * object every instance shares — is what lets the last owner decide when the
 * element goes, so an unload never strips styles another owner still renders
 * with. Removing the element on the first release is the bug this prevents.
 *
 * @param doc - document to install into.
 * @param tagId - element id, also the handle for a later lookup.
 * @param css - rules to install.
 * @param countKey - `data-` key holding this sheet's owner count.
 * @returns a disposer that releases this call's claim exactly once.
 */
function installCounted(doc: Document, tagId: string, css: string, countKey: string): () => void {
  const root = doc.documentElement
  const element = doc.getElementById(tagId) ?? createStyle(doc, tagId, css)
  const claimed = Number.parseInt(root.dataset[countKey] ?? '', 10)
  const owners = Number.isNaN(claimed) ? 0 : claimed
  root.dataset[countKey] = String(owners + 1)
  let released = false
  return () => {
    // An effect cleanup can run twice (a hot reload tears down, re-applies and
    // tears down again); counting that as two releases would remove the element
    // from under the other owner.
    if (released) return
    released = true
    const remaining = Number.parseInt(root.dataset[countKey] ?? '', 10)
    const left = (Number.isNaN(remaining) ? 1 : remaining) - 1
    if (left > 0) {
      root.dataset[countKey] = String(left)
      return
    }
    delete root.dataset[countKey]
    element.remove()
  }
}

/**
 * Install the shared primitives (dialog, buttons, banner, dialog rows).
 *
 * Called from `apply` inside `ctx.effect`, so unloading the component releases
 * its claim; the element stays while the other bundle still holds one.
 *
 * @param doc - document to install into.
 * @returns a disposer that releases this call's claim.
 */
export function installBaseStyles(doc: Document): () => void {
  return installCounted(doc, BASE_STYLE_ID, BASE_CSS, BASE_STYLE_COUNT)
}
