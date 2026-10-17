/** The last named parts of a path, accepting both platform separators and trailing separators. */
export function pathTail(path: string, depth = 1): string {
  return path
    .split(/[\\/]+/)
    .filter(Boolean)
    .slice(-depth)
    .join('/')
}
