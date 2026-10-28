/**
 * dsh-hello-world - the plugin bundle.
 *
 * The bundle itself carries no runtime behaviour: its `cordis.patch.yml` inserts
 * the two component rows, and each component is a package under `packages/`.
 * This module exists so the package resolves like every other DSH plugin.
 */

/** Bundle name; also the directory name the plugin manager groups under. */
export const name = 'dsh-hello-world'
