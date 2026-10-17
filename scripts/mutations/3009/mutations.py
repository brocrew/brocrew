"""3009 · D-032's window half · a kept picture or PDF, drawn and let go — 51ad0388.

⛔ **The subject**: the window's side of the boundary for untrusted files. A kept file is drawn
from main's answer alone: its type is main's `drawnAs`, never the agent's name; a PDF is ONE frame
in exactly the shape the navigation guard and the header policy admit; every URL the window makes
is let go when the file shown changes and when the panel closes; a drawing answered for another
id, or one that lands after a later press, is never drawn and makes no URL.

## ⚑ What a row here measures

 * ⚑ **M1, M2 are the URL's lifetime** (`KeptFileDrawing.vue`): a switch, and a close, revoke it.
   They are independent: under M1 the close still lets the last URL go but never an earlier one;
   under M2 a switch still lets go, but the close does not.
 * ⚑ **M3, M4 are which answer is drawn**: the echoed id (`CanonicalDocumentViewer.vue`) and the
   stale answer dropped after a later press (`CanonicalDocumentOverlay.vue`).
 * ⚑ **M5, M6 are the frame**: the type off `drawnAs`, and no `sandbox` (under which Chromium's
   viewer does not load, and which the census of its attributes refuses).
 * ⚑ **M7 is the undecodable picture said**, not left as a broken `<img>`.
 * ⚑ **M8 is the draw door asked only for a picture or a PDF** — never for a text file.

## ⛔ What this table does not contain

 * ⚠️ The refusal wording, the header's "Image · size" and the name's `unicode-bidi` isolation —
   words and small UI, not the boundary.
 * ⚠️ The main process's reading of the bytes, the frame guard, the header policy and
   `kept-file-urls.ts` (5266657a): their rows are table 3008's.
"""

DRAWING = "apps/desktop/src/renderer/src/components/KeptFileDrawing.vue"
VIEWER = "apps/desktop/src/renderer/src/components/CanonicalDocumentViewer.vue"
OVERLAY = "apps/desktop/src/renderer/src/components/CanonicalDocumentOverlay.vue"

DOM = "a-kept-picture-or-pdf-is-drawn-and-let-go.dom.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · 🔴 the old URL is never revoked when the file shown changes — PDF → picture leaves the "
        f"PDF's blob alive · killed by `{DOM}`",
        [(DRAWING,
          "    shown.value?.release()\n    shown.value = null\n    broken.value = false\n",
          "    shown.value = null\n    broken.value = false\n")],
    ),
    (
        "M2 · 🔴 the URL is never revoked when the panel closes — by its button, Esc, the backdrop or "
        f"a conversation switch · killed by `{DOM}`",
        [(DRAWING,
          "onBeforeUnmount(() => {\n  shown.value?.release()\n",
          "onBeforeUnmount(() => {\n")],
    ),
    (
        "M3 · 🔴 a drawing answered for ANOTHER id is drawn under this file's header · killed by "
        f"`{DOM}`",
        [(VIEWER,
          '      v-else-if="result.ok && drawing?.ok && drawing.resourceId === result.resourceId"\n',
          '      v-else-if="result.ok && drawing?.ok"\n')],
    ),
    (
        "M4 · 🔴 a stale answer that lands after a later press replaces it and makes a URL · killed "
        f"by `{DOM}`",
        [(OVERLAY,
          "  if (asked !== opens) return\n",
          "")],
    ),
    (
        "M5 · 🔴 **the type off the NAME** · the frame/picture choice is read off the agent's file "
        f"name, so a `.pdf` main drew as PNG is framed · killed by `{DOM}`",
        [(DRAWING,
          "    isPdf.value = drawing.drawnAs === 'application/pdf'\n",
          "    isPdf.value = drawing.name.toLowerCase().endsWith('.pdf')\n")],
    ),
    (
        "M6 · the PDF frame carries a `sandbox`, under which Chromium's viewer does not load · "
        f"killed by `{DOM}`",
        [(DRAWING,
          '      class="pdf-frame"\n',
          '      class="pdf-frame"\n      sandbox="allow-scripts"\n')],
    ),
    (
        "M7 · bytes the window cannot decode are left as a broken `<img>`, never said · killed by "
        f"`{DOM}`",
        [(DRAWING,
          '      @error="broken = true"\n',
          "")],
    ),
    (
        "M8 · the draw door is asked for a Markdown file too, not only a picture or a PDF · killed "
        f"by `{DOM}`",
        [(OVERLAY,
          "    result.ok && result.text === null && (result.form === 'image' || result.form === 'pdf')\n",
          "    result.ok\n")],
    ),
]
