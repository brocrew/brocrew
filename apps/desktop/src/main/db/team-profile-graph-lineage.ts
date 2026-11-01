import type { GraphNode, GraphCoverage } from '../../shared/team-profile-graph'
import { TEAM_PROFILE_GRAPH_BOUNDS as B } from '../../shared/team-profile-graph'

// Iterative SCC and bitset reachability bound both stack and transitive work.
export function graphLineage(
  nodes: GraphNode[],
  parents: Map<string, string>,
  coverage: GraphCoverage,
  reserve: (bytes: number) => void,
  check: () => void,
): void {
  check()
  if (parents.size === 0) return
  const count = nodes.length
  const indices = new Map(nodes.map((n, i) => [n.id, i]))
  reserve(count * 256)
  const children: number[][] = Array.from({ length: count }, () => [])
  const reverse: number[][] = Array.from({ length: count }, () => [])
  let operations = 0
  const step = () => {
    if (++operations > B.lineageOps) throw new Error('lineage budget')
    if (operations % 256 === 0) check()
  }
  for (const [child, parent] of parents) {
    step()
    const c = indices.get(child)!,
      p = indices.get(parent)!
    children[p]!.push(c)
    reverse[c]!.push(p)
    if (c !== p) nodes[p]!.directDescendants++
  }
  const visited = new Uint8Array(count),
    order: number[] = []
  for (let start = 0; start < count; start++) {
    if (visited[start]) continue
    const stack: [number, number][] = [[start, 0]]
    visited[start] = 1
    while (stack.length) {
      step()
      const top = stack.at(-1)!,
        next = children[top[0]]![top[1]++]
      if (next === undefined) {
        order.push(top[0])
        stack.pop()
      } else if (!visited[next]) {
        visited[next] = 1
        stack.push([next, 0])
      }
    }
  }
  const component = new Int32Array(count).fill(-1),
    members: number[][] = []
  for (let cursor = order.length - 1; cursor >= 0; cursor--) {
    const start = order[cursor]!
    if (component[start] !== -1) continue
    const cid = members.length,
      group: number[] = [],
      stack = [start]
    component[start] = cid
    while (stack.length) {
      step()
      const n = stack.pop()!
      group.push(n)
      for (const p of reverse[n]!)
        if (component[p] === -1) {
          component[p] = cid
          stack.push(p)
        }
    }
    members.push(group)
    if (group.length > 1 || children[start]!.includes(start)) coverage.cyclicCreatorComponents++
  }
  const edges: number[][] = Array.from({ length: members.length }, () => []),
    indegree = new Uint32Array(members.length)
  for (let p = 0; p < count; p++)
    for (const c of children[p]!) {
      step()
      const a = component[p]!,
        b = component[c]!
      if (a !== b) {
        edges[a]!.push(b)
        indegree[b] = indegree[b]! + 1
      }
    }
  const ready: number[] = [],
    topo: number[] = []
  for (let i = 0; i < indegree.length; i++) if (!indegree[i]) ready.push(i)
  for (let cursor = 0; cursor < ready.length; cursor++) {
    const a = ready[cursor]!
    topo.push(a)
    for (const b of edges[a]!) {
      step()
      indegree[b] = indegree[b]! - 1
      if (indegree[b] === 0) ready.push(b)
    }
  }
  const words = Math.ceil(count / 32),
    bytes = members.length * words * 4
  reserve(bytes)
  const bits = new Uint32Array(members.length * words)
  for (let t = topo.length - 1; t >= 0; t--) {
    const a = topo[t]!,
      base = a * words
    for (const n of members[a]!) {
      step()
      bits[base + (n >>> 5)]! |= 1 << (n & 31)
    }
    for (const b of edges[a]!)
      for (let w = 0; w < words; w++) {
        step()
        bits[base + w]! |= bits[b * words + w]!
      }
    let reachable = 0
    for (let w = 0; w < words; w++) {
      step()
      let v = bits[base + w]!
      v -= (v >>> 1) & 0x55555555
      v = (v & 0x33333333) + ((v >>> 2) & 0x33333333)
      reachable += (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
    }
    for (const n of members[a]!) nodes[n]!.descendants = reachable - 1
  }
  check()
}
