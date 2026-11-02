import { spawn } from 'node:child_process'
import type { GraphScaleInput, GraphScaleSample } from './graph-scale-child'

/** A child must finish and exit inside the existing 20-second sample budget. */
export function runGraphScaleChild(
  bundle: string,
  input: GraphScaleInput,
): Promise<GraphScaleSample> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bundle, JSON.stringify(input)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let output = '',
      errors = ''
    let failure: Error | undefined
    const stop = (error: Error) => {
      failure ??= error
      child.kill('SIGKILL')
    }
    // Leave one second for owned-process cleanup before Vitest's unchanged timeout.
    const timeout = setTimeout(
      () => stop(new Error('Graph sample child exceeded 19 seconds')),
      19000,
    )
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      if (output.length + chunk.length > 1024 * 1024) {
        stop(new Error('Graph sample child output exceeded its budget'))
      } else output += chunk
    })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      if (errors.length + chunk.length > 64 * 1024) {
        stop(new Error('Graph sample child errors exceeded their budget'))
      } else errors += chunk
    })
    child.once('error', (error) => (failure ??= error))
    child.once('close', (code, signal) => {
      clearTimeout(timeout)
      if (failure) reject(failure)
      else if (code !== 0 || signal !== null)
        reject(new Error(`Graph sample child failed (${code ?? signal}): ${errors}`))
      else {
        try {
          resolve(JSON.parse(output) as GraphScaleSample)
        } catch (error) {
          reject(error)
        }
      }
    })
  })
}
