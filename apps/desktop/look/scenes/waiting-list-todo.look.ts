import { scene } from '../capture'
import { waitingList } from '../fixtures/waiting-lists'

scene('waiting-list-todo', (stage) => waitingList(stage, 'todo'))
