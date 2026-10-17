"""3006 · the Providers screen's facts — `9e0b6c40`.

⚑ **The subject**: what a person's Providers screen shows, and where each fact comes from. A usable
Claude login says its plan and when the LOGIN ends — the refresh token's end, as Claude's own
"login expires in N days" counts it, and nothing where that notice would say nothing
(`claudeLoginFacts`). Each provider's version is read from what this install bundles, once per run,
and Codex is asked in a home of its own (`providerVersionsReader`). Each adapter turns what its
provider already sends about its limits into a `provider_usage` reading, near a limit or not
(`rateLimitUsage` in both `normalize.ts`), which the host keeps in memory — the newest per window, a
sparse reading not a reset — forgets when what the provider runs on changes, and no longer takes
from a conversation still running on the older login (`takeTheUsage`, `providerLoginChanged`). What
the agents use is summed from ONE process listing by the pids this app spawned
(`listProcesses`, `resourcesFromTheListing`), measured only when asked, one at a time
(`providerResources`).

## ⚑ What a row here measures

 * ⚑ **M1–M3 · the sum from the listing** — a root that has left the listing is not running, every
   process under a root is counted (its tool commands), and a process is counted once across both
   providers.
 * ⚑ **M4–M5 · the bundled versions** — an ask that failed for a passing reason is asked again, and
   Codex is run in a home of its own, never the person's.
 * ⚑ **M6–M8 · the adapters' readings** — Claude's `utilization` is a fraction made a percent, a
   throttle still carries its reading beside the error, and Codex reads the bucket as merged across
   frames rather than the sparse frame alone.
 * ⚑ **M9–M11 · the host's readings** — a sparse reading keeps what the provider last said, a login
   change forgets the readings, and a conversation on the older login no longer feeds them.
 * ⚑ **M12 · the single flight** — an ask while one is under way joins it.
 * ⚑ **M13–M14 · the login's facts** — the end is the refresh token's, and a refresh end the access
   token outlives by more than three days is stale.

## ⛔ What this table cannot reach

 * ⚠️ **`LC_ALL: 'C'` on the listing** — the test machine's locale writes a decimal point, so a
   listing under the person's locale reads the same; nothing goes red.
 * ⚠️ **`resourcesFromTheListing`'s `row.ppid === row.pid` skip** — equivalent today: `counted` already
   stops the walk at a pid seen once, so a process listed as its own parent cannot loop either way.
 * ⚠️ **`providerVersionsReader`'s rejection arm** (`codex = null` on a throw) — `codexVersion` catches
   everything it can meet, so the arm is unreachable from a test.
 * ⚠️ **Claude's version** (`claudeVersion`) — the killer accepts either a version or a sentence, by
   design, since what the SDK ships depends on the install.
 * ⚠️ **Left out for count, killable**: `listProcesses` asking for the command too (the parse skips
   every line, and the listing rejects), the Codex home not removed after, a missing binary asked
   again, the host telling the windows on a reading that moved nothing, the profile scope of a login
   change, the five-second hold's `age >= 0` (a clock set back), Codex's reset left in seconds, and
   an empty `subscriptionType` read as a plan. M1–M14 already measure the path each belongs to.
"""

LISTING = "apps/desktop/src/main/runtime/process-listing.ts"
VERSIONS = "apps/desktop/src/main/runtime/provider-versions.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
CLAUDE_NORMALIZE = "packages/runtime/src/claude/normalize.ts"
CODEX_NORMALIZE = "packages/runtime/src/codex/normalize.ts"
AUTH = "packages/runtime/src/internal/auth.ts"

BUNDLED = "what-the-agents-use-and-what-is-bundled.test.ts"
SCREEN = "what-the-providers-screen-reads-from-the-host.test.ts"
READINGS = "provider-usage-readings.test.ts"
LOGIN_FACTS = "claude-login-facts.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ---- A · the sum from one listing (process-listing.ts) --------------------------------------
    # BUNDLED · 'resourcesFromTheListing' › '⛔ a root that is no longer in the listing is not running
    # and counts nothing' — `{ claude: [10, 999] }` answers `running: 2`, not 1.
    (
        "M1 · a root that has left the listing is still counted as running — an agent that exited "
        f"reads as one still at work · killed by `{BUNDLED}`",
        [(LISTING,
          "      if (!byPid.has(root)) continue\n"
          "      running += 1\n",
          "      running += 1\n")],
    ),
    # BUNDLED · 'resourcesFromTheListing' › '🔴 sums each provider’s roots and everything under them,
    # children included, by KiB → bytes' — claude reads 1_000 KiB and 5% CPU, not 1_250 and 7.8.
    (
        "M2 · only the roots are summed — the tool commands an agent started, and theirs, are never "
        f"counted · killed by `{BUNDLED}`",
        [(LISTING,
          "        cpu += row.cpu\n"
          "        waiting.push(...(children.get(pid) ?? []))\n",
          "        cpu += row.cpu\n")],
    ),
    # BUNDLED · 'resourcesFromTheListing' › '⛔ a process under two roots is counted once, and a root
    # under another root is not counted twice' — `shared.codex` reads 200 KiB, not 0.
    (
        "M3 · each provider keeps its own count of what it has summed — a process under a Claude root "
        f"and a Codex root is counted for both · killed by `{BUNDLED}`",
        [(LISTING,
          "  const counted = new Set<number>()\n"
          "  const sum = (provider: Provider): ProviderResources => {\n",
          "  const sum = (provider: Provider): ProviderResources => {\n"
          "    const counted = new Set<number>()\n")],
    ),

    # ---- B · the bundled versions (provider-versions.ts) ----------------------------------------
    # BUNDLED · 'providerVersionsReader' › '🔴 a binary that fails for a passing reason is asked again
    # next time, and says so' — the second read still says it could not be asked.
    (
        "M4 · an ask that failed for a passing reason is kept for the run — Codex's version is never "
        f"asked again · killed by `{BUNDLED}`",
        [(VERSIONS,
          "        if (!final) codex = null\n",
          "        void final\n")],
    ),
    # BUNDLED · 'providerVersionsReader' › '🔴 Codex’s version is what the bundled binary prints, read
    # in a home of its own that is removed after' — `$HOME` is the person's, not `brobot-codex-version-…`.
    (
        "M5 · Codex is asked its version with this app's own environment — it runs in the person's "
        f"home and lays its `tmp/` down in their `~/.codex` · killed by `{BUNDLED}`",
        [(VERSIONS,
          # ⚑ **the Codex program a launch runs · re-anchored in place, not retired** — Codex's version read now passes the Windows names a program needs there, as Claude's does; the plant still hands it the person's own environment.
          "          env: {\n            HOME: own,\n            CODEX_HOME: own,\n            PATH: process.platform === 'win32' ? (process.env.PATH ?? '') : '/usr/bin:/bin',\n            ...(process.platform === 'win32'\n              ? { USERPROFILE: own, SystemRoot: process.env.SystemRoot ?? 'C:\\\\Windows' }\n              : {}),\n          },\n",
          "          env: { ...process.env, PATH: '/usr/bin:/bin' },\n")],
    ),

    # ---- C · the adapters' readings (both normalize.ts) -----------------------------------------
    # READINGS · 'Claude · rate_limit_event → provider_usage' › '🔴 every unified window is a reading:
    # the fraction becomes a percent to a tenth, seconds become ms' — usedPercent 0.92, not 92.
    (
        "M6 · Claude's `utilization` is carried as the fraction it is — a window 92% full reads as "
        f"under one percent · killed by `{READINGS}`",
        [(CLAUDE_NORMALIZE,
          "            ? Math.round(utilization * 1000) / 10\n",
          "            ? utilization\n")],
    ),
    # READINGS · 'Claude · rate_limit_event → provider_usage' › '⛔ a throttle keeps its error AND
    # carries the reading beside it' — `usageOf(events)` is undefined.
    (
        "M7 · a throttle is said as its error alone — the reading that frame carried is dropped, so "
        f"the Providers screen misses the window at its wall · killed by `{READINGS}`",
        [(CLAUDE_NORMALIZE,
          "      if (throttle) return withTheReading([{ type: 'error', message: throttle, fatal: false }])\n",
          "      if (throttle) return [{ type: 'error', message: throttle, fatal: false }]\n")],
    ),
    # READINGS · 'Codex · account/rateLimits/updated → provider_usage' › '⛔ a sparse frame does not
    # read as a window that lost its reset: the held bucket is merged in' — one reading, its reset null.
    (
        "M8 · Codex reads the frame alone, never the bucket as merged — a sparse frame reads as a "
        f"window that lost its reset and its other window · killed by `{READINGS}`",
        [(CODEX_NORMALIZE,
          "      const usage = rateLimitUsage(watch ? watch.lastReading() : { snapshot, mainLimitId: null })\n",
          "      const usage = rateLimitUsage({ snapshot, mainLimitId: null })\n")],
    ),

    # ---- D · the host's readings (runtime-host.ts) ----------------------------------------------
    # SCREEN · 'usage' › '⛔ a sparse reading is not a reset: a field the provider left out keeps what
    # it last said' — the third reading leaves usedPercent null, not 80.
    (
        "M9 · a reading that leaves out how full a window is wipes what the provider last said — a "
        f"sparse update reads as a reset · killed by `{SCREEN}`",
        [(HOST,
          "      const usedPercent = reading.usedPercent ?? before?.usedPercent ?? null\n",
          "      const usedPercent = reading.usedPercent\n")],
    ),
    # SCREEN · 'usage' › '🔴 what a provider runs on changing forgets its readings, tells both facts,
    # and leaves the other provider alone' — `providerUsage().claude` still holds the old reading.
    (
        "M10 · a login change tells the windows the usage moved but keeps the readings — the screen "
        f"shows the old login's usage against the new one · killed by `{SCREEN}`",
        [(HOST,
          # ⚑ **W4.166 · F096 · re-anchored in place, not retired** — the forgetting moved into `forgetTheUsage`, which a login change in this app and the Mac's sign-in moving now share; the mutation still keeps the readings while it tells the windows
          "    if (!this.usage.delete(provider)) return\n",
          "    if (!this.usage.has(provider)) return\n")],
    ),
    # SCREEN · 'usage' › '⛔ a conversation still running on the older login no longer feeds the
    # readings — one started after does' — 'an older login’s reading was kept'.
    (
        "M11 · a conversation still running on the older login feeds the readings — its 95% is kept "
        f"as the new login's · killed by `{SCREEN}`",
        [(HOST,
          # ⚑ **W4.166 · F096 · re-anchored in place, not retired** — the older-login test moved into `readsAnOlderLogin`, which also covers a life older than the Mac's last sign-in change; the mutation still feeds every life's readings
          # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. held: running it needs W4's written lift. f74aec1e5 passes the session into account-aware usage attribution; preserve that argument while removing only the same older-login caller gate.
          "      if (!this.readsAnOlderLogin(session)) this.takeTheUsage(session, event)\n",
          "      this.takeTheUsage(session, event)\n")],
    ),

    # ---- E · the single flight (runtime-host.ts) ------------------------------------------------
    # SCREEN · 'resources' › '⚑ asks that arrive while one is under way join it, and one inside five
    # seconds of the last is answered with it' — 'a second ask started a second listing'.
    (
        "M12 · an ask while a measurement is under way starts another listing — two screens asking "
        f"at once run `ps` twice · killed by `{SCREEN}`",
        [(HOST,
          "    if (this.resourcesMeasuring !== null) return this.resourcesMeasuring\n"
          "    const last = this.resourcesMeasured\n",
          "    const last = this.resourcesMeasured\n")],
    ),

    # ---- F · the login's facts (auth.ts · claudeLoginFacts) -------------------------------------
    # LOGIN_FACTS · 'claudeLoginFacts' › '🔴 says the plan and the refresh token’s end' — expiresAt is
    # NOW + 8 hours (the access token's), not NOW + 20 days.
    (
        "M13 · the login's end is the access token's — a login good for weeks reads as ending within "
        f"hours, every few hours · killed by `{LOGIN_FACTS}`",
        [(AUTH,
          "    expiresAt: said ? ends : null,\n",
          "    expiresAt: token.expiresAt,\n")],
    ),
    # LOGIN_FACTS · 'claudeLoginFacts' › '⚑ an access token that outlives the end by more than three
    # days makes the end stale, and by less does not' — `end + 3 * DAY + 1` still answers `end`.
    (
        "M14 · a refresh end the access token outlives by days is still said — a renewal that brought "
        f"no new end shows the old one as the login's end · killed by `{LOGIN_FACTS}`",
        [(AUTH,
          "    (token.expiresAt === null || token.expiresAt <= ends + CLAUDE_LOGIN_END_SLACK_MS)\n",
          "    true\n")],
    ),
]
