// Started by a test of the seal: says which home this process has.
import { homedir } from 'node:os'

process.stdout.write(homedir())
