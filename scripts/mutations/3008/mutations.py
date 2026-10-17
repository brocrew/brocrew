"""3008 · D-032 · a kept picture or PDF, drawn from bytes nobody trusts — 5266657a.

⛔ **The subject**: the boundary for untrusted files. A kept file is typed by its BYTES, never its
name, and refused past 16 MiB or 64 megapixels; the window frames only a PDF, only in Chromium's
own viewer under a `blob:` URL the app minted, and only in the shape that was measured; the app's
header policy is passed over for the viewer's own pages and no others; the window makes a frame's
URL only for a PDF and an SVG only as a `data:` picture.

## ⚑ What a row here measures

 * ⚑ **M1–M3, M6, M7, M15 are the main process's reading of the bytes** (`resources.ts`): the type
   off the bytes (`%PDF-`, the PNG signature), the first element of an SVG, the pixel cap on the
   product, the 16 MiB bound, and a changed file said as changed when it is shown in Finder.
 * ⚑ **M4, M8–M10, M13, M14 are the subframe guard** (`window-navigation.ts`): an event that does
   not say it is a subframe, a blob the app did not mint, a blob at the wrong depth, the viewer
   under anything but the app's own blob, an opaque dev origin, the viewer's id behind a password.
 * ⚑ **M5 is the header policy** (`content-security-policy.ts`): passed over for the viewer only.
 * ⚑ **M11, M12 are the window's one maker of URLs** (`kept-file-urls.ts`): `pdfFrameUrl`'s
   refusal of anything but a PDF, and an SVG only as a `data:` picture.
 * ⚑ **M16 is the reveal door** (`ipc.ts`): Show in Finder reaches Finder.

## ⛔ What this table does not contain

 * ⚠️ The JPEG segment walk's Huffman-table skip — a misread size, not a safety boundary.
 * ⚠️ `KeptFileDrawing.vue` (the window half, 51ad0388): its rows are table 3009's.
"""

RES = "apps/desktop/src/main/resources/resources.ts"
NAV = "apps/desktop/src/main/window-navigation.ts"
CSP = "apps/desktop/src/shared/content-security-policy.ts"
URLS = "apps/desktop/src/renderer/src/lib/kept-file-urls.ts"
IPC = "apps/desktop/src/main/runtime/ipc.ts"

BYTES = "what-a-kept-picture-is-read-off-its-own-bytes.test.ts"
DOORS = "a-person-draws-a-kept-picture-and-finds-it-in-finder.test.ts"
FRAME = "the-pdf-frame-is-admitted-in-the-measured-shape-only.test.ts"
POLICY = "the-policy-gains-blob-twice-and-passes-over-only-the-viewer.test.ts"
MAKER = "kept-file-urls-take-the-type-main-gave.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · 🔴 a pixel bomb with one side at most 8192 is decoded whole — the cap reads each side, "
        f"not their product · killed by `{BYTES}` and `{DOORS}`",
        [(RES,
          "if (size.width * size.height > MOST_PIXELS_A_WINDOW_DRAWS) {",
          "if (size.width > 8192 && size.height > 8192) {")],
    ),
    (
        "M2 · 🔴 a page that merely holds an inline `<svg>` is typed `image/svg+xml` and handed to "
        f"the window as a picture · killed by `{BYTES}`",
        [(RES,
          "return /^<svg[\\s/>]/.test(text.slice(at, at + 5))",
          "return text.includes('<svg')")],
    ),
    (
        "M3 · a kept file whose bytes changed is shown in Finder as if it were intact · killed by "
        f"`{BYTES}` and `{DOORS}`",
        [(RES,
          "return { ok: true, path: join(resolve(root), row.sha256, row.name), changed: !read.ok }",
          "return { ok: true, path: join(resolve(root), row.sha256, row.name), changed: false }")],
    ),
    (
        "M4 · 🔴 a frame event that does not say it is a subframe is admitted by the subframe rule "
        f"· killed by `{FRAME}`",
        [(NAV,
          "if (policy.framesAPdf && details.isMainFrame === false) {",
          "if (policy.framesAPdf && !details.isMainFrame) {")],
    ),
    (
        "M5 · 🔴 every extension's pages, not only the PDF viewer's, escape the app's header policy "
        f"· killed by `{POLICY}`",
        [(CSP,
          "if (details.url?.startsWith(`${PDF_VIEWER_ORIGIN}/`) === true) {",
          "if (details.url?.startsWith('chrome-extension://') === true) {")],
    ),
    (
        "M6 · 🔴 **the type off the NAME** · any bytes kept as a PDF are typed `application/pdf` "
        f"and framed in the viewer, `%PDF-` or not · killed by `{BYTES}`",
        [(RES,
          "  if (form === 'pdf') return bytes.subarray(0, 1024).includes('%PDF-') ? 'application/pdf' : null\n",
          "  if (form === 'pdf') return 'application/pdf'\n")],
    ),
    (
        "M7 · 🔴 **the type off the NAME** · any bytes kept as a picture are typed `image/png`, so "
        f"a page renamed `.png` is drawn as a picture · killed by `{BYTES}`",
        [(RES,
          "  if (opensWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'\n",
          "  if (form === 'image') return 'image/png'\n")],
    ),
    (
        "M8 · 🔴 **the blob guard admits every blob** · in a packaged build any `blob:` URL passes as "
        f"one the app minted · killed by `{FRAME}`",
        [(NAV,
          "  if (document.devServerUrl === undefined) return inner.protocol === 'file:' && inner.host === ''\n",
          "  if (document.devServerUrl === undefined) return true\n")],
    ),
    (
        "M9 · 🔴 the app's own blob loads as a frame at ANY depth, not only directly under the app "
        f"· killed by `{FRAME}`",
        [(NAV,
          "  if (isOwnBlob(document, candidate)) return ancestors.length === 0\n",
          "  if (isOwnBlob(document, candidate)) return true\n")],
    ),
    (
        "M10 · 🔴 the PDF viewer loads under any frame, not only under a blob the app minted · "
        f"killed by `{FRAME}`",
        [(NAV,
          "    isOwnBlob(document, blob) &&\n",
          "    blob !== undefined &&\n")],
    ),
    (
        "M11 · 🔴 **`pdfFrameUrl` frames anything** · a picture main typed is handed to a frame as "
        f"a PDF blob · killed by `{MAKER}`",
        [(URLS,
          "  if (drawnAs !== 'application/pdf') {\n",
          "  if (false) {\n")],
    ),
    (
        "M12 · 🔴 an SVG becomes a `blob:` URL instead of a `data:` picture · killed by "
        f"`{MAKER}`",
        [(URLS,
          "  if (drawnAs === 'image/svg+xml') {\n",
          "  if (false) {\n")],
    ),
    (
        "M13 · in development an OPAQUE origin compares equal to every opaque (`blob:file:`) blob "
        f"· killed by `{FRAME}`",
        [(NAV,
          "return server !== null && server.origin !== 'null' && inner.origin === server.origin",
          "return server !== null && inner.origin === server.origin")],
    ),
    (
        "M14 · the viewer's id behind a password passes as the viewer · killed by "
        f"`{FRAME}`",
        [(NAV,
          "    target.password === '' &&\n",
          "    true &&\n")],
    ),
    (
        "M15 · a 16 MiB file, the most this app keeps, can no longer be drawn — the bound refuses "
        f"its own size · killed by `{BYTES}` and `{DOORS}`",
        [(RES,
          "if (row.bytes > MOST_BYTES_A_WINDOW_DRAWS) return { ok: false, reason: 'too-large' }",
          "if (row.bytes >= MOST_BYTES_A_WINDOW_DRAWS) return { ok: false, reason: 'too-large' }")],
    ),
    (
        "M16 · Show in Finder answers with a drawing and never asks Finder · killed by "
        f"`{DOORS}`",
        [(IPC,
          "return host.revealResource(command.resourceId)",
          "return host.drawResourceForAPerson(command.resourceId)")],
    ),
]
