"""3018 · the ui commits — 714955ca, 25cca325, b975fa15, 5d5a991a, cd842ee3, 40826342.

⛔ **The subject**: what the window does with a credential, a provider's facts, a model's name, a
server's link and the build it is — the logic these six commits brought, not their wording. A key
typed leaves the field as it is sent; a saved key outranks a sign-in; the Providers screen samples
only while it is looked at, one sample at a time, and a login notice landed during a gesture is not
lost; only a STOPPED wall heads a card; a model typed in another letter case is the listed model;
Copy link offers only an address the card would show, and only while the card is unanswered; a
develop build says which of its branches it holds, how far behind, and which it left out.

## ⚑ What a row here measures

 * ⚑ **M1, M2, M11–M14 are 25cca325** (`ProviderCard.vue`, `ProvidersScreen.vue`, DOM killers):
   the key field emptied before the call, a saved key this Mac cannot read still outranking the
   sign-in, the sampling gate (looked at, never overlapping, stopped by a blur), and the login
   notice held across a gesture.
 * ⚑ **M3, M4 are cd842ee3** (`PermissionCard.vue`, DOM killer): a format character (a
   right-to-left override) is never offered for copying, and an answered card offers nothing.
 * ⚑ **M5–M8 are 40826342** (`build-stamp.ts`): only a build of develop is a combination; only
   exit 1 from git is "no"; "behind" and "left out" are told apart; clean and conflicting too.
 * ⚑ **M9, M10 are b975fa15** (`usage-limit.ts`): only a stopped wall heads the card, and "at
   least" where another wall named no reset.
 * ⚑ **M15, M16 are 5d5a991a** (`model-lists.ts`): what the form sends, and what the card and the
   picker's face show. ⚠️ M15 shares its line with table 2007 M9, which drops the effort compare;
   M15 plants a different defect (`sameModel` → `===`, a case-variant last pick sent anyway), so it
   is kept, anchored on the same whole line.
 * ⚑ **M17, M18 are 714955ca** (`developer-views.ts`): Debug mode off hides Events, and a hidden
   tab asked for lands on the default.

## ⛔ What this table does not contain

 * ⚠️ Dropped for the 18-row cap, least risky first: `usage-limit.ts`'s `readingSays`
   `Math.round` → `Math.floor` and `AppTitleBar.vue`'s "merges cleanly" condition (wording);
   b975fa15's `at <= now` → `at < now` and cd842ee3's `> 4096` → `>= 4096` (one-value boundaries);
   40826342's `build-identity.ts` half-read of an `older` stamp (a malformed stamp the app wrote
   itself); 5d5a991a's `thePickerRows` case-variant pick (an extra "(no longer listed)" row, drawn
   only — M15 and M16 measure the same `sameModel` use where it changes what is sent or shown).
 * ⚠️ `2caad6d2`, `cc07a78c`, `e6fcc6ab`, `ae53076e`: no rows (a screen, a re-pointing, wording).
"""

CARD = "apps/desktop/src/renderer/src/components/ProviderCard.vue"
SCREEN = "apps/desktop/src/renderer/src/components/ProvidersScreen.vue"
PERMISSION = "apps/desktop/src/renderer/src/components/PermissionCard.vue"
STAMP = "apps/desktop/src/main/build-stamp.ts"
LIMIT = "apps/desktop/src/renderer/src/lib/usage-limit.ts"
LISTS = "apps/desktop/src/renderer/src/lib/model-lists.ts"
VIEWS = "apps/desktop/src/renderer/src/lib/developer-views.ts"

CARD_DOM = "the-providers-card-keeps-no-key-and-hears-its-login.dom.test.ts"
SCREEN_DOM = "the-providers-screen-samples-only-while-looked-at.dom.test.ts"
LINK_DOM = "a-servers-link-is-copied-with-one-press.dom.test.ts"
BRANCHES = "a-develop-build-says-which-branches-it-holds.render.test.ts"
AT_LIMIT = "a-provider-at-its-limit-and-each-reading-said-plainly.test.ts"
MODEL = "a-model-named-as-people-type-it-is-the-listed-model.test.ts"
DEBUG = "debug-mode-offers-the-developer-views-only-when-on.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · 🔴 **the API key stays in the field while it is sent** · a refused key is still on "
        f"the page · killed by `{CARD_DOM}`",
        [(CARD,
          "  const key = keyDraft.value.trim()\n  keyDraft.value = ''\n",
          "  const key = keyDraft.value.trim()\n")],
    ),
    (
        "M2 · 🔴 a saved key this Mac cannot read no longer outranks the sign-in — Sign in is "
        f"offered and the host refuses it · killed by `{CARD_DOM}`",
        [(CARD,
          "  if (status.state !== 'available' || keyStatus.value?.set !== true) return status\n",
          "  if (status.state !== 'available' || keyStatus.value?.inUse !== true) return status\n")],
    ),
    (
        "M3 · 🔴 **a right-to-left override is copied** · an address with a format character, "
        f"which shows one address and copies another, is offered · killed by `{LINK_DOM}`",
        [(PERMISSION,
          "\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}",
          "\\p{Cc}\\p{Zl}\\p{Zp}")],
    ),
    (
        "M4 · Copy link stays on an answered card · killed by "
        f"`{LINK_DOM}`",
        [(PERMISSION,
          "        v-if=\"serverLink && !answered\"\n",
          "        v-if=\"serverLink\"\n")],
    ),
    (
        "M5 · 🔴 a build of any branch is read as a combination — a lane's build names branches it "
        f"never meant to hold · killed by `{BRANCHES}`",
        [(STAMP,
          "    if (git(['symbolic-ref', '--quiet', '--short', 'HEAD']) !== COMBINED_BRANCH) return null\n",
          "")],
    ),
    (
        "M6 · 🔴 **\"git would not say\" reads as \"not held\"** · any failure of a yes-or-no git "
        f"command is \"no\", never \"not known\" · killed by `{BRANCHES}`",
        [(STAMP,
          "    if ((error as { status?: unknown }).status === 1) return false\n",
          "    return false\n")],
    ),
    (
        "M7 · 🔴 \"behind\" and \"left out\" are swapped — a branch merged at an older tip is said as "
        f"left out, and one left out as behind · killed by `{BRANCHES}`",
        [(STAMP,
          "        !others.some((one) => yesOrNo(exec, ['merge-base', '--is-ancestor', shared, one.tip]))\n",
          "        others.some((one) => yesOrNo(exec, ['merge-base', '--is-ancestor', shared, one.tip]))\n")],
    ),
    (
        "M8 · a clean merge is said as a conflict and a conflict as clean · killed by "
        f"`{BRANCHES}`",
        [(STAMP,
          "    return !yesOrNo(exec, [\n      'merge-tree',\n",
          "    return yesOrNo(exec, [\n      'merge-tree',\n")],
    ),
    (
        "M9 · 🔴 a wall only about to stop heads the card \"At its limit\" — not what F074's hold "
        f"does · killed by `{AT_LIMIT}`",
        [(LIMIT,
          "  if (condition.standing !== 'stopped') return null\n",
          "  if (condition.standing === undefined) return null\n")],
    ),
    (
        "M10 · a bare 429 beside a timed wall promises the time — \"until\", never \"at least until\" "
        f"· killed by `{AT_LIMIT}`",
        [(LIMIT,
          "untimed ? 'at least ' : ''",
          "untimed ? '' : ''")],
    ),
    (
        "M11 · 🔴 a sample answered after the window left the front arms the next one — the screen "
        f"samples in the background · killed by `{SCREEN_DOM}`",
        [(SCREEN,
          "  if (looking.value && timer === null) timer = setTimeout(tick, SAMPLE_MS)\n",
          "  if (timer === null) timer = setTimeout(tick, SAMPLE_MS)\n")],
    ),
    (
        "M12 · two samples overlap — the next is asked before the last one answered · killed by "
        f"`{SCREEN_DOM}`",
        [(SCREEN,
          "  if (sampling) return\n",
          "")],
    ),
    (
        "M13 · the window leaving the front does not stop the armed timer · killed by "
        f"`{SCREEN_DOM}`",
        [(SCREEN,
          "  } else if (timer !== null) {\n",
          "  } else if (false) {\n")],
    ),
    (
        "M14 · a login notice that lands while a copy is out is lost — the card never turns Ready "
        f"· killed by `{CARD_DOM}`",
        [(CARD,
          "    if (checkAgain) {\n",
          "    if (false) {\n")],
    ),
    (
        "M15 · the form sends a last pick the host would start on anyway, when the two spell one "
        f"model differently · killed by `{MODEL}`",
        [(LISTS,
          "  return starts !== null && sameModel(starts.model, last.model) && starts.effort === last.effort\n",
          "  return starts !== null && starts.model === last.model && starts.effort === last.effort\n")],
    ),
    (
        "M16 · the Providers card and the picker's face show the stored spelling, not the list's · "
        f"killed by `{MODEL}` and `{CARD_DOM}`",
        [(LISTS,
          "  return list?.models.find((row) => sameModel(row.id, id))?.id ?? id\n",
          "  return list?.models.find((row) => row.id === id)?.id ?? id\n")],
    ),
    (
        "M17 · 🔴 Debug mode off hides nothing — Events and its raw list are offered to everyone · "
        f"killed by `{DEBUG}` and `{SCREEN_DOM}`",
        [(VIEWS,
          "  return debugMode ? [] : DEVELOPER_TABS\n",
          "  return []\n")],
    ),
    (
        "M18 · a hidden tab asked for stays selected — the side panel lands on Events with Debug "
        f"mode off · killed by `{DEBUG}`",
        [(VIEWS,
          "  return hidden.includes(tab) ? DEFAULT_TAB : tab\n",
          "  return tab\n")],
    ),
]
