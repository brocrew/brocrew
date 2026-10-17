import type { MainThreadWork } from '../stall-watch'

interface WindowTarget {
  isDestroyed(): boolean
  readonly webContents: {
    isDestroyed(): boolean
    send(channel: string, message: unknown): void
  }
}

export function broadcastRuntime(
  windows: () => readonly WindowTarget[],
  channel: string,
  message: unknown,
  failed: (error: unknown) => void,
  timing: Pick<MainThreadWork, 'timed'>,
  phase: 'window state broadcast' | 'window change broadcast' | 'window provider broadcast',
): void {
  timing.timed(phase, () => {
    for (const window of windows()) {
      try {
        if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
          window.webContents.send(channel, message)
        }
      } catch (error) {
        failed(error)
      }
    }
  })
}
