import { PROVIDER_DESCRIPTORS } from '@brobot2/shared'
import { providerCatalogue } from '../../src/renderer/src/client-provider/catalogue'
import { desktopProviderApi } from '../../src/renderer/src/client-provider/window'

/**
 * Reads the desktop client's provider catalogue once, answered with the shared descriptors. The
 * answer is kept for the rest of the file, as it is for a window, so rows drawn afterwards name
 * providers the way the window does, whatever host the test stubs later. Works in a server render
 * (no window) and in the browser.
 */
export async function answerTheCatalogue(): Promise<void> {
  const answered = { runtime: { providerCatalogue: async () => PROVIDER_DESCRIPTORS } }
  if (typeof window === 'undefined') {
    const host = globalThis as { window?: unknown }
    host.window = { api: answered }
    try {
      await providerCatalogue(desktopProviderApi).read()
    } finally {
      delete host.window
    }
    return
  }
  const page = window as unknown as { api?: unknown }
  const before = page.api
  page.api = answered
  try {
    await providerCatalogue(desktopProviderApi).read()
  } finally {
    page.api = before
  }
}
