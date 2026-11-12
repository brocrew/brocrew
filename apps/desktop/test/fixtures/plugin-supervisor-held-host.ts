import { createPluginNodeHost as createHost } from '../../src/main/plugins/node-host'

export function createPluginNodeHost(...args: Parameters<typeof createHost>) {
  const host = createHost(...args)
  if (!process.argv.includes('shutdown-reject')) return host
  return {
    ...host,
    async stop() {
      process.send?.({ event: 'host-stop-waiting' })
      await new Promise<void>((resolve) => {
        function release(message: unknown) {
          if (message !== 'release-host-stop') return
          process.off('message', release)
          resolve()
        }
        process.on('message', release)
      })
      return host.stop()
    },
  }
}
