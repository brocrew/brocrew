import type { Session, WebContents } from 'electron'
const plugins = new WeakSet<object>()
const pluginSessions = new WeakSet<Session>()
export function markPluginSession(session: Session): void {
  pluginSessions.add(session)
}
export function markPluginSender(contents: object): void {
  plugins.add(contents)
}
export function isPluginSender(contents: Pick<WebContents, 'getURL' | 'session'>): boolean {
  if (plugins.has(contents)) return true
  try {
    return (
      pluginSessions.has(contents.session) ||
      new URL(contents.getURL()).protocol === 'brocrew-plugin:'
    )
  } catch {
    return false
  }
}
