import './lib/logging'
import { createApp } from 'vue'
import App from './App.vue'
import { CLIENT_PROVIDERS } from './client-provider/injection'
import { desktopBootstrap, desktopProviderApi } from './client-provider/window'
import './assets/base.css'
import { draftHandoffBeforeDrawing, SAVED_DRAFTS } from './lib/kept-drafts'
import { keepTheMacZone } from './lib/local-zone'
import { startPageStallWatch } from './lib/page-stall-watch'
import { useOverlays } from './lib/overlay-store'
import { themeChangeNotices } from './lib/theme-change-notice'
import { startWindowTheme, themeBeforeDrawing } from './lib/window-theme'

const pageWatch =
  window.top === window && desktopBootstrap.canReportPagePerformance
    ? startPageStallWatch((report) => desktopBootstrap.recordPagePerformance(report))
    : null
import.meta.hot?.dispose(() => pageWatch?.stop())

// Read the system time zone before the first paint so displayed times agree with the system.
// Then restore saved drafts before mounting so each composer starts with its unsent text.
// `draftHandoffBeforeDrawing` bounds the restore wait; an unreadable file must not prevent drawing.
// The workspace's theme is read alongside, so the first paint is already in it. Bounded like the
// drafts: past the wait the window draws in its own look and the theme follows.
const windowTheme = startWindowTheme(
  window.top === window ? desktopProviderApi.themes : undefined,
  {
    onChange: themeChangeNotices(useOverlays()),
  },
)
import.meta.hot?.dispose(() => windowTheme.stop())

void Promise.all([keepTheMacZone(desktopBootstrap.zone), themeBeforeDrawing(windowTheme)]).then(
  () =>
    draftHandoffBeforeDrawing(desktopBootstrap.savedDrafts).then((handoff) => {
      createApp(App)
        .provide(SAVED_DRAFTS, handoff)
        .provide(CLIENT_PROVIDERS, desktopProviderApi)
        .mount('#app')
      pageWatch?.mounted()
    }),
)
