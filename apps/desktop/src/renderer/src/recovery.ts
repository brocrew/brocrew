import { createApp } from 'vue'
import RecoveryApp from './components/RecoveryApp.vue'
import { keepTheMacZone } from './lib/local-zone'
import './assets/base.css'

/** How long the first paint waits for the computer's time zone before drawing without it. */
const ZONE_WITHIN_MS = 1500

const bridge = window.recovery ?? null

const zone = bridge
  ? keepTheMacZone({ localZone: () => bridge.zone(), onLocalZone: () => () => {} })
  : keepTheMacZone(undefined)

void Promise.race([zone, new Promise((done) => setTimeout(done, ZONE_WITHIN_MS))]).then(() => {
  createApp(RecoveryApp, { bridge }).mount('#app')
})
