import { afterEach, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount, unmountAll } from './harness'
import TeamProfileGraph from '../../src/renderer/src/components/TeamProfileGraph.vue'
import {
  createTeamProfileGraph,
  provideTeamProfileGraph,
} from '../../src/renderer/src/composables/useTeamProfileGraph'
import { fictionalGraph, fictionalGraphWire } from '../fixtures/team-profile-graph-view'

afterEach(() => {
  unmountAll()
  vi.restoreAllMocks()
})

it('keeps every painted graph label outside every painted node circle', async () => {
  const frames = new WeakMap<
    HTMLCanvasElement,
    {
      circles: { x: number; y: number; r: number }[]
      text: { value: string; left: number; top: number; right: number; bottom: number }[]
    }
  >()
  const proto = CanvasRenderingContext2D.prototype
  const clear = proto.clearRect,
    arc = proto.arc,
    fill = proto.fillText
  vi.spyOn(proto, 'clearRect').mockImplementation(function (
    this: CanvasRenderingContext2D,
    ...args
  ) {
    frames.set(this.canvas, { circles: [], text: [] })
    return clear.apply(this, args)
  })
  vi.spyOn(proto, 'arc').mockImplementation(function (this: CanvasRenderingContext2D, ...args) {
    frames.get(this.canvas)?.circles.push({ x: args[0], y: args[1], r: args[2] })
    return arc.apply(this, args)
  })
  vi.spyOn(proto, 'fillText').mockImplementation(function (
    this: CanvasRenderingContext2D,
    value,
    x,
    y,
    ...rest
  ) {
    const m = this.measureText(value)
    frames.get(this.canvas)?.text.push({
      value,
      left: x - m.actualBoundingBoxLeft,
      top: y - m.actualBoundingBoxAscent,
      right: x + m.actualBoundingBoxRight,
      bottom: y + m.actualBoundingBoxDescent,
    })
    return fill.call(this, value, x, y, ...rest)
  })
  const graph = fictionalGraph(12)
  const names = [
    'BroBot',
    'Ada',
    'Ali',
    'Mira',
    'Noor',
    'Sami',
    'Lea',
    'Omar',
    'Nia',
    'Iris',
    'Bo',
    'Luca',
  ]
  graph.nodes.forEach((node, i) => {
    node.name = names[i]!
    node.conversations = (i % 6) + 1
    node.kind = i === 3 ? 'service' : 'normal'
    node.kindQuality = 'stable-record'
  })
  const component = defineComponent({
    setup() {
      provideTeamProfileGraph(
        createTeamProfileGraph({
          read: fictionalGraphWire(graph),
          workspace: () => 'fictional-label-check',
        }),
      )
      return () => h(TeamProfileGraph, { active: true })
    },
  })
  await document.fonts.ready
  const mounted = mount(component, {}, { width: 696, height: 1100 })
  await nextTick()
  await new Promise((r) => setTimeout(r, 1200))
  const canvas = mounted.host.querySelector('canvas')!
  const frame = frames.get(canvas)!
  expect(frame.circles.length).toBeGreaterThan(10)
  expect(frame.text.length).toBeGreaterThan(6)
  const overlaps = frame.text.flatMap((label) =>
    frame.circles
      .filter((circle) => {
        const nx = Math.max(label.left, Math.min(circle.x, label.right))
        const ny = Math.max(label.top, Math.min(circle.y, label.bottom))
        return Math.hypot(circle.x - nx, circle.y - ny) < circle.r
      })
      .map((circle) => ({ label: label.value, rectangle: label, circle })),
  )
  expect(overlaps).toEqual([])
  expect(mounted.host.textContent).toContain('Mira')
  expect(mounted.host.textContent).toContain('Nia')
}, 10000)
