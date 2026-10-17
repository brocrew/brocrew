import { createApp } from 'vue'
import RecoveryApp from './components/RecoveryApp.vue'
import { keepTheMacZone } from './lib/local-zone'
import './assets/base.css'

/** How long the first paint waits for the computer's time zone before drawing without it. */
const ZONE_WITHIN_MS = 1500

// The recovery window's own entry. Its preload exposes only `window.recovery`, so nothing here
// reaches `window.api`: no drafts and no runtime. The time zone comes from the recovery bridge and
// is asked for before mounting, as the main window does, so dates read as the computer's clock
// does. The wait is bounded: a slow or failing answer still mounts, and a late one redraws them.
const bridge = window.recovery ?? null

const zone = bridge
  ? keepTheMacZone({ localZone: () => bridge.zone(), onLocalZone: () => () => {} })
  : keepTheMacZone(undefined)

void Promise.race([zone, new Promise((done) => setTimeout(done, ZONE_WITHIN_MS))]).then(() => {
  createApp(RecoveryApp, { bridge }).mount('#app')
})
