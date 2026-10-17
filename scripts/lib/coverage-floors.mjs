export const COVERAGE_AREAS = Object.freeze([
  'main',
  'preload',
  'renderer',
  'shared',
  'runtime',
  'other packages',
  'overall',
])
export const COVERAGE_METRICS = Object.freeze(['lines', 'branches', 'functions'])

function record(value, keys, label) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  ) {
    throw new Error(`Invalid ${label}`)
  }
}

function counter(value, label) {
  record(value, ['covered', 'total'], label)
  if (
    !Number.isSafeInteger(value.covered) ||
    !Number.isSafeInteger(value.total) ||
    value.covered < 0 ||
    value.total < value.covered
  ) {
    throw new Error(`Invalid ${label}`)
  }
}

function floors(value) {
  record(value, COVERAGE_AREAS, 'floor areas')
  for (const area of COVERAGE_AREAS) {
    record(value[area], COVERAGE_METRICS, `${area} floors`)
    for (const metric of COVERAGE_METRICS) {
      const floor = value[area][metric]
      if (floor !== null && (!Number.isInteger(floor) || floor < 0 || floor > 1000)) {
        throw new Error(`Invalid ${area} ${metric} floor`)
      }
    }
  }
}

// Floors use integer tenths of a percent. Collection and source/exit proof belong to the caller.
export function nextCoverageFloors(previous, counts) {
  record(counts, COVERAGE_AREAS, 'coverage areas')
  if (previous !== null) floors(previous)
  for (const area of COVERAGE_AREAS) {
    record(counts[area], COVERAGE_METRICS, `${area} counters`)
    for (const metric of COVERAGE_METRICS)
      counter(counts[area][metric], `${area} ${metric} counters`)
  }
  for (const metric of COVERAGE_METRICS) {
    for (const key of ['covered', 'total']) {
      const sum = COVERAGE_AREAS.slice(0, -1).reduce(
        (total, area) => total + BigInt(counts[area][metric][key]),
        0n,
      )
      if (sum !== BigInt(counts.overall[metric][key])) {
        throw new Error(`Overall ${metric} ${key} does not match its areas`)
      }
    }
  }
  const next = {}
  for (const area of COVERAGE_AREAS) {
    next[area] = {}
    for (const metric of COVERAGE_METRICS) {
      const { covered, total } = counts[area][metric]
      const old = previous?.[area][metric] ?? null
      if (total === 0) {
        if (old !== null) throw new Error(`Missing counters for stored ${area} ${metric} floor`)
        next[area][metric] = null
      } else {
        const numerator = 1000n * BigInt(covered)
        if (old !== null && numerator < BigInt(old) * BigInt(total)) {
          throw new Error(`Coverage below floor: ${area} ${metric} < ${old / 10}%`)
        }
        const observed = Number(numerator / BigInt(total))
        next[area][metric] = Math.max(old ?? 0, observed)
      }
    }
  }
  return next
}

// The candidate must inherit every stored floor from the actual landing target.
export function assertFloorsNotLowered(target, candidate) {
  floors(target)
  floors(candidate)
  for (const area of COVERAGE_AREAS) {
    for (const metric of COVERAGE_METRICS) {
      const old = target[area][metric]
      const proposed = candidate[area][metric]
      if (old !== null && (proposed === null || proposed < old)) {
        throw new Error(`Stored floor lowered: ${area} ${metric}`)
      }
    }
  }
}
