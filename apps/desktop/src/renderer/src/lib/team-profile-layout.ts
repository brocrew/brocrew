import { z } from 'zod'
const finite = z.number().finite().min(-1e8).max(1e8)
const generation = z.number().int().nonnegative().safe()
export const layoutCommand = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('init'),
    generation,
    nodes: z
      .array(z.strictObject({ x: finite, y: finite, radius: z.number().min(4).max(21) }))
      .max(1000),
    links: z
      .array(
        z.strictObject({
          source: z.number().int().min(0).max(999),
          target: z.number().int().min(0).max(999),
          weight: z.number().min(0).max(1),
        }),
      )
      .max(5000),
    distance: z.number().min(30).max(220),
    repulsion: z.number().min(20).max(500),
    messages: z.boolean(),
    running: z.boolean(),
    alpha: z.union([z.literal(0.5), z.literal(0.85)]),
  }),
  z.strictObject({ type: z.literal('run'), generation }),
  z.strictObject({ type: z.literal('pause'), generation }),
  z.strictObject({ type: z.literal('ack'), generation }),
  z.strictObject({
    type: z.literal('pin'),
    generation,
    index: z.number().int().min(0).max(999),
    x: finite,
    y: finite,
    held: z.boolean(),
  }),
])
export type LayoutCommand = z.infer<typeof layoutCommand>
export type LayoutReply =
  | { type: 'positions'; generation: number; positions: Float64Array }
  | { type: 'paused'; generation: number }
  | { type: 'failed'; generation: number }
