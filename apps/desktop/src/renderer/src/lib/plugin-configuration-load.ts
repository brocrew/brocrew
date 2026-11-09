import {
  PLUGIN_CONFIGURATION_TIMEOUT,
  type PluginSettingsReply,
} from '../../../shared/plugin-settings'
const unavailable = (detail?: string): PluginSettingsReply => ({
  ok: false,
  error: 'Plugin unavailable. Try again.',
  ...(detail ? { detail } : {}),
})

/** Bound the whole Configure request, including owner start and catalogue reads. */
export async function loadPluginConfiguration(
  open: () => Promise<PluginSettingsReply>,
  signal: AbortSignal,
): Promise<PluginSettingsReply> {
  if (signal.aborted) return unavailable()
  let timer: ReturnType<typeof setTimeout> | undefined
  let canceled: (() => void) | undefined
  try {
    return await Promise.race([
      Promise.resolve()
        .then(() => (signal.aborted ? unavailable() : open()))
        .catch(() => unavailable('The Settings request failed before a reply was received.')),
      new Promise<PluginSettingsReply>((resolve) => {
        canceled = () => resolve(unavailable())
        signal.addEventListener('abort', canceled, { once: true })
        timer = setTimeout(
          () => resolve(unavailable('The plugin Settings page took too long to open.')),
          PLUGIN_CONFIGURATION_TIMEOUT,
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
    if (canceled) signal.removeEventListener('abort', canceled)
  }
}
