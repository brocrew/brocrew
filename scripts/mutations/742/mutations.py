"""742 · an answer that never lands is bounded — `739` F-6.

⛔ **The defect**: `respondPermission` and `respondUserInput` awaited the adapter's answer with no
bound, so an adapter whose answer never settled held the person's IPC for good — the card dark, and
Home saying *"answer sent — waiting for the conversation to settle"* with nothing ever following
(standing rule 8.4). ⚑ `RuntimeHost.answerTheProvider` waits `interruptWaitMs` — `interrupt`'s own
bound — then answers `unacknowledged`, releasing the waiter and not the work.

## ⚑ What a row here measures

 * ⚑ **M1–M2 are the defect, verbatim** — each door awaiting its answer whole.
 * ⚑ **M3–M5 are the bound** — that it answers at all, with the wait it waited, of the length configured.
 * ⚑ **M6–M8 are the work the waiter let go of** — a late answer recorded, never on a life put away,
   and a late refusal logged as late.
 * ⚑ **M9–M10 are the prompt paths the bound must not change** — a fault still throws, and a handle
   that throws its refusal is still classified.

## ⛔ What this table cannot reach

 * ⚠️ **Both `clearTimeout(bound)`** — a timer left running flips `released` on an answer already
   given and resolves a promise already settled; nothing reads either afterwards.
 * ⚠️ **Where `taken` runs** — on the answer's own reaction rather than after a race. Moving it is
   not a one-line mutation; the first draft did it and 86 existing tests went red (the provider's next
   events reached the ledger ahead of the row), so those tests are its guard.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"

KILLER = "an-answer-that-never-lands-is-bounded.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · the decision is awaited whole — the defect, verbatim: a provider that never takes it "
        f"holds the person's IPC for good · killed by `{KILLER}`",
        [(HOST,
          "    return await this.answerTheProvider(\n"
          "      session,\n"
          "      requestId,\n"
          "      () => session.handle.respondPermission(requestId, decision),\n"
          "      () => this.aPermissionWasTaken(session, requestId, decision, by),\n"
          "    )\n",
          "    try {\n"
          "      await session.handle.respondPermission(requestId, decision)\n"
          "    } catch (error) {\n"
          "      const refused = this.refusalOf(sessionId, requestId, error)\n"
          "      if (refused === null) throw error\n"
          "      return refused\n"
          "    }\n"
          "    this.aPermissionWasTaken(session, requestId, decision, by)\n"
          "    return { outcome: 'taken' }\n")],
    ),
    (
        "M2 · a question's answer is awaited whole — the same defect, on the other door · "
        f"killed by `{KILLER}`",
        [(HOST,
          "    return await this.answerTheProvider(\n"
          "      session,\n"
          "      requestId,\n"
          "      () => session.handle.respondUserInput(requestId, response),\n"
          "      () => this.aQuestionWasTaken(session, requestId, response, by),\n"
          "    )\n",
          "    try {\n"
          "      await session.handle.respondUserInput(requestId, response)\n"
          "    } catch (error) {\n"
          "      const refused = this.refusalOf(sessionId, requestId, error)\n"
          "      if (refused === null) throw error\n"
          "      return refused\n"
          "    }\n"
          "    this.aQuestionWasTaken(session, requestId, response, by)\n"
          "    return { outcome: 'taken' }\n")],
    ),
    (
        "M3 · the bound passes and says nothing — the waiter is never released · "
        f"killed by `{KILLER}`",
        [(HOST,
          "        released = true\n"
          "        resolve({ outcome: 'unacknowledged', waitedMs: this.interruptWaitMs })\n",
          "        released = true\n")],
    ),
    (
        "M4 · the wait the door reports is not the wait it waited — a surface saying the number "
        f"says a false one (rule 8.2) · killed by `{KILLER}`",
        [(HOST,
          "        resolve({ outcome: 'unacknowledged', waitedMs: this.interruptWaitMs })\n",
          "        resolve({ outcome: 'unacknowledged', waitedMs: DEFAULT_INTERRUPT_WAIT_MS })\n")],
    ),
    (
        "M5 · the bound is not the one configured — the host's own default, whatever it was given · "
        f"killed by `{KILLER}`",
        [(HOST,
          "      }, this.interruptWaitMs)\n      answering\n",
          "      }, DEFAULT_INTERRUPT_WAIT_MS)\n      answering\n")],
    ),
    (
        "M6 · an answer the provider takes after the bound is never recorded — the card it answered "
        f"is never settled · killed by `{KILLER}`",
        [(HOST,
          "            if (!released || this.isCurrentLife(session)) taken()\n",
          "            if (!released) taken()\n")],
    ),
    (
        "M7 · a late answer is recorded on a life put away — a `user_decision` row after the "
        f"conversation's ending · killed by `{KILLER}`",
        [(HOST,
          "            if (!released || this.isCurrentLife(session)) taken()\n",
          "            taken()\n")],
    ),
    (
        "M8 · a late refusal is classified as a prompt one — the log never says the host had "
        f"stopped waiting, and the person was told `unacknowledged` · killed by `{KILLER}`",
        [(HOST, "            if (released) throw error\n", "")],
    ),
    (
        "M9 · a fault inside the bound is swallowed — its timer is already cleared, so the door never "
        f"answers at all: `main`'s hang, for an answer that failed · killed by `{KILLER}`",
        [(HOST,
          "          if (!released) {\n            reject(error)\n            return\n          }\n",
          "          if (!released) return\n")],
    ),
    (
        "M10 · a handle that throws its refusal, rather than rejecting, escapes classification — "
        f"the person meets a fault where `main` said the refusal · killed by `{KILLER}`",
        [(HOST, "      answering = Promise.reject(error)\n", "      throw error\n")],
    ),
]
