/** A current retitle takes precedence over the title the work arrived with. */
export function currentWorkTitle(
  given: string | null,
  retitled: Record<string, unknown> | null,
): string | null {
  return typeof retitled?.title === 'string' ? retitled.title : given
}
