// Inert fixture contract: Windows admits roots separately in each process. Enforce that
// ordering on POSIX too, so the standalone fixture cannot omit its Windows bootstrap again.
import {
  keepPluginRootPrivate as prepareRoot,
  isInsideCheckedRoot as checkedRoot,
  isWithinOrSame,
} from '../../src/main/plugins/private-files'
export * from '../../src/main/plugins/private-files'
const admitted = new Set<string>()
export async function keepPluginRootPrivate(
  ...args: Parameters<typeof prepareRoot>
): Promise<void> {
  await prepareRoot(...args)
  admitted.add(args[0])
}
export function isInsideCheckedRoot(...args: Parameters<typeof checkedRoot>): boolean {
  return [...admitted].some((root) => isWithinOrSame(root, args[0])) && checkedRoot(...args)
}
