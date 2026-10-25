/// <reference lib="webworker" />
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceX,
  forceY,
  forceCollide,
  type Simulation,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from 'd3-force'
import { layoutCommand, type LayoutReply } from '../lib/team-profile-layout'
type Node = SimulationNodeDatum & { radius: number }
type Link = SimulationLinkDatum<Node> & { weight: number }
let simulation: Simulation<Node, Link> | undefined,
  generation = 0,
  running = false,
  outstanding = false
let timer: ReturnType<typeof setTimeout> | undefined,
  ticks = 0,
  started = 0,
  lastFrame = -Infinity
const send = (reply: LayoutReply): void => {
  self.postMessage(reply)
}
function pause(): void {
  running = false
  clearTimeout(timer)
  send({ type: 'paused', generation })
}
function frame(): void {
  if (!running || !simulation) return
  const begin = performance.now()
  do {
    simulation.tick()
    ticks++
  } while (ticks < 300 && simulation.alpha() > 0.001 && performance.now() - begin < 8)
  if (!outstanding && performance.now() - lastFrame >= 1000 / 30) {
    const positions = new Float64Array(simulation.nodes().length * 2)
    simulation.nodes().forEach((n, i) => {
      positions[i * 2] = n.x!
      positions[i * 2 + 1] = n.y!
    })
    self.postMessage({ type: 'positions', generation, positions } satisfies LayoutReply, [
      positions.buffer,
    ])
    outstanding = true
    lastFrame = performance.now()
  }
  if (ticks >= 300 || simulation.alpha() <= 0.001 || performance.now() - started >= 3000) pause()
  else timer = setTimeout(frame, 0)
}
function run(alpha: number): void {
  if (!simulation) return
  clearTimeout(timer)
  running = true
  ticks = 0
  started = performance.now()
  simulation.alpha(alpha)
  timer = setTimeout(frame, 0)
}
self.onmessage = (event: MessageEvent<unknown>) => {
  const parsed = layoutCommand.safeParse(event.data)
  if (!parsed.success) {
    pause()
    send({ type: 'failed', generation })
    return
  }
  const command = parsed.data
  if (command.type === 'init') {
    if (command.generation < generation) return
    clearTimeout(timer)
    simulation?.stop()
    generation = command.generation
    running = false
    outstanding = false
    lastFrame = -Infinity
    if (
      command.links.some(
        (l) =>
          l.source >= command.nodes.length ||
          l.target >= command.nodes.length ||
          l.source === l.target,
      )
    ) {
      send({ type: 'failed', generation })
      return
    }
    const nodes: Node[] = command.nodes.map((n) => ({ ...n }))
    const links: Link[] = command.links.map((l) => ({ ...l }))
    simulation = forceSimulation(nodes)
      .stop()
      .velocityDecay(0.3)
      .alphaDecay(0.035)
      .alphaMin(0.001)
      .force(
        'links',
        forceLink<Node, Link>(links)
          .distance(
            (l) =>
              command.distance * (command.messages ? 1.75 - 1.35 * l.weight : 1.2 - 0.5 * l.weight),
          )
          .strength((l) => (command.messages ? 0.1 + 0.7 * l.weight : 0.08 + 0.35 * l.weight)),
      )
      .force('charge', forceManyBody<Node>().strength(-command.repulsion))
      .force('x', forceX<Node>(0).strength(0.035))
      .force('y', forceY<Node>(0).strength(0.035))
      .force(
        'collide',
        forceCollide<Node>().radius((n) => n.radius + 12),
      )
    if (command.running) run(command.alpha)
    return
  }
  if (command.generation !== generation) return
  if (command.type === 'ack') outstanding = false
  else if (command.type === 'pause') pause()
  else if (command.type === 'run') run(0.85)
  else if (command.type === 'pin' && simulation) {
    const node = simulation.nodes()[command.index]
    if (!node) return
    node.x = command.x
    node.y = command.y
    node.vx = 0
    node.vy = 0
    node.fx = command.held ? command.x : null
    node.fy = command.held ? command.y : null
    simulation.alphaTarget(command.held ? 0.25 : 0)
    if (running) {
      simulation.alpha(0.6)
      ticks = 0
    }
  }
}
