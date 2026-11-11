import { expect, it, vi } from 'vitest'
import { createSSRApp, defineComponent, h, provide } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { CLIENT_PROVIDERS } from '../src/renderer/src/client-provider/injection'
import { createDesktopProviderApi } from '../src/renderer/src/client-provider/desktop'
import ProfileSkills from '../src/renderer/src/components/ProfileSkills.vue'
import SkillsSection from '../src/renderer/src/components/SkillsSection.vue'

it.each([() => h(ProfileSkills, { profileSlug: 'fern', active: false }), () => h(SkillsSection)])(
  'sets up an injected skill view without reading a session getter or window',
  async (render) => {
    expect(typeof window).toBe('undefined')
    const sessions = vi.fn((): never => {
      throw new Error('No session resolution during setup')
    })
    const api = createDesktopProviderApi(
      (): never => {
        throw new Error('No provider read expected')
      },
      () => undefined,
      () => undefined,
      sessions,
    )
    const app = createSSRApp(
      defineComponent({
        setup() {
          provide(CLIENT_PROVIDERS, api)
          return render
        },
      }),
    )
    expect(await renderToString(app)).toContain('Skills')
    expect(sessions).not.toHaveBeenCalled()
  },
)
