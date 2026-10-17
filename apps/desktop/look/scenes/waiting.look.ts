import { scene } from '../capture'
import { waitingPage } from '../fixtures/waiting'

scene('waiting', (stage) => waitingPage(stage, false))
