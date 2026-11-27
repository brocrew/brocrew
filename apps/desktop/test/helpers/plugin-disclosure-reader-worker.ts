import { observeInstalledPackage } from '../../src/main/plugins/state/observe-committed'
export function displayRead(options: { root: string; workspaceRoots: string[] }, id: string) {
  return observeInstalledPackage(options, id)
}
