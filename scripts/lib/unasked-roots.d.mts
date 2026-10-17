/**
 * Types for folders Codex can write under `ask` without approval; see `unasked-roots.mjs`.
 * Return the containing writable folder, or `null` when the target needs an approval request.
 */
export function writableUnasked(
  path: string,
  cwd: string,
  options?: { readonly temporary?: readonly string[] },
): string | null
