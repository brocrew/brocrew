#!/usr/bin/env python3
"""Correct mutation rows' anchors IN PLACE, by position, and never retire one.

⚑ **716 · the repair `census.py` asks a person for** (README, *A row that goes retired*): an anchor
whose text MOVED is corrected where it stands, annotated, and re-verified RED. ⛔ Until `716` every
seat did the first two by hand or with a one-off script — `reanchor710.py` was the last of those, and
this is it, landed. It changes table DATA only: the literal a row's anchor (and, when asked, its
replacement) is written as, at its exact position in the table's source, with a note above it.

For every spec, and it REFUSES — writing nothing in any table — rather than guess:

1. each table is read through ``table_contract``'s own loader, never imported or executed, and its
   row is found by its canonical id; **all three row shapes** are read — ``(label, file, old, new)``,
   ``(label, project, [edits])`` and ``(label, [edits])``;
2. the text being replaced must be a string literal in the row, or a name bound to one that nothing
   else in the table reads — ⛔ correcting a SHARED constant moves every row that reads it, so it is
   refused unless each of those rows is listed, with ``"shared": true``, correcting it to the SAME
   text; a concatenation, an f-string or a ``.replace()`` is refused: correct those by hand;
3. the new anchor must match the live file the row names exactly once, and differ from its
   replacement;
4. the splice is made by UTF-8 byte column (``ast`` reports bytes; an em dash earlier on the line
   moves a character offset), and the note — ``# ⚑ **<by> · re-anchored in place, not retired** —
   <note>`` — goes above the line the literal starts on.

⚑ **Then the table is read back**: each corrected edit must be exactly the spec's, each corrected
row must pass the contract's own dry apply (its edits in order), and every OTHER row's label and
edits must be byte-for-byte what they were. ⛔ The first table that does not read back as planned
puts every table this run wrote back to its original bytes, and the rest are not written (exit 3).
⚠️ ``--dry-run`` plans only: the read-back needs a written table, so it is not asked.

⛔ **It does NOT verify a row RED.** A corrected anchor keeps a verdict it never earned: run
``verify_row.py TABLE ROW`` on every row it corrected.

usage: python3 scripts/mutations/reanchor.py SPECS.json --by DISPATCH [--root DIR] [--dry-run]

``SPECS.json`` is a list of ``{"table": "310", "row": "M4", "edit": 0, "anchor": "…",
"replacement": "…", "note": "…"}`` — ``edit`` defaults to 0 and ``replacement`` to the row's own;
``"shared": true`` lets a constant several rows read be corrected, once, for all of them.
Exit 0: written (or, with ``--dry-run``, planned) · 2: refused, nothing written · 3: a table did not
read back as planned, and its original bytes were written back.
"""

from __future__ import annotations

import argparse
import ast
import json
import pathlib
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent / "lib"))

import table_contract  # noqa: E402

REPO = pathlib.Path(__file__).resolve().parents[2]


class Refused(Exception):
    """A spec this tool will not apply; nothing has been written."""


class Splice:
    """One literal to rewrite: its byte span in the source, the new text, and the note above it."""

    def __init__(
        self, node: ast.expr, text: str, note: str | None, shared: tuple[str, int] | None = None
    ) -> None:
        self.node = node
        self.text = text
        self.note = note
        # ⚑ The shared name this literal is bound to and how many places read it, or None.
        self.shared = shared


def _lines(source: str) -> list[bytes]:
    return source.encode("utf-8").splitlines(keepends=True)


def _offset(lines: list[bytes], lineno: int, column: int) -> int:
    """⚠️ ``ast`` columns are UTF-8 BYTES, so the offset is taken in the encoded source."""

    return sum(len(line) for line in lines[: lineno - 1]) + column


def _mutations_node(tree: ast.Module, table: str) -> ast.List | ast.Tuple:
    for statement in tree.body:
        targets = (
            statement.targets
            if isinstance(statement, ast.Assign)
            else [statement.target]
            if isinstance(statement, ast.AnnAssign)
            else []
        )
        if any(getattr(target, "id", None) == "MUTATIONS" for target in targets):
            if not isinstance(statement.value, (ast.List, ast.Tuple)):
                raise Refused(f"{table}: MUTATIONS is not a literal list, so a row has no position")
            return statement.value
    raise Refused(f"{table}: no MUTATIONS")


def _binding(tree: ast.Module, name: str) -> ast.expr:
    """The literal a top-level name is bound to — refused unless it is bound once, to a string."""

    values = []
    for statement in tree.body:
        targets = (
            statement.targets
            if isinstance(statement, ast.Assign)
            else [statement.target]
            if isinstance(statement, ast.AnnAssign)
            else []
        )
        if any(getattr(target, "id", None) == name for target in targets):
            values.append(statement.value)
    if len(values) != 1:
        raise Refused(f"{name} is bound {len(values)} times, so there is no one literal to correct")
    value = values[0]
    if not (isinstance(value, ast.Constant) and isinstance(value.value, str)):
        raise Refused(f"{name} is bound to an expression, not a string literal — correct it by hand")
    return value


def _literal(
    tree: ast.Module, node: ast.expr, what: str, shared: bool = False
) -> tuple[ast.expr, tuple[str, int] | None]:
    """The string literal behind one field of an edit — and, for a shared name, which and how many
    read it — or a refusal saying why there is none."""

    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node, None
    if isinstance(node, ast.Name):
        # ⛔ A name another row (or another constant) reads is SHARED: correcting it moves every
        # reader, so it is refused unless the spec says so AND lists them all (checked in `plan`).
        readers = sum(
            1
            for one in ast.walk(tree)
            if isinstance(one, ast.Name) and one.id == node.id and isinstance(one.ctx, ast.Load)
        )
        if readers != 1 and not shared:
            raise Refused(
                f"the {what} is {node.id}, which {readers} places in the table read — correcting it "
                'would move every one of them; list each of those rows with "shared": true, or give '
                "this row its own literal by hand"
            )
        return _binding(tree, node.id), ((node.id, readers) if readers != 1 else None)
    raise Refused(
        f"the {what} is a {type(node).__name__} expression, not a string literal — correct it by hand"
    )


def _edit_fields(row: ast.expr, edit: int, label: str) -> tuple[ast.expr, ast.expr]:
    """The anchor and replacement nodes of one edit, in any of the three row shapes."""

    if not isinstance(row, (ast.Tuple, ast.List)):
        raise Refused(f"{label}: the row is not a literal tuple")
    if len(row.elts) == 4:  # (label, file, old, new)
        if edit != 0:
            raise Refused(f"{label}: a (label, file, old, new) row has one edit, and it is edit 0")
        return row.elts[2], row.elts[3]
    if len(row.elts) in (2, 3):  # (label, [edits]) and (label, project, [edits])
        edits = row.elts[-1]
        if not isinstance(edits, (ast.List, ast.Tuple)):
            raise Refused(f"{label}: its edits are not a literal list")
        if not 0 <= edit < len(edits.elts):
            raise Refused(f"{label}: it has {len(edits.elts)} edits, and there is no edit {edit}")
        one = edits.elts[edit]
        if not isinstance(one, (ast.Tuple, ast.List)) or len(one.elts) != 3:
            raise Refused(f"{label}: edit {edit} is not a literal (file, old, new)")
        return one.elts[1], one.elts[2]
    raise Refused(f"{label}: an unrecognised row shape of {len(row.elts)} fields")


def plan(root: pathlib.Path, specs: list[dict], by: str) -> dict[pathlib.Path, tuple[str, str, dict]]:
    """Every table's corrected source, its original, and the edits it must read back as."""

    by_table: dict[str, list[dict]] = {}
    for spec in specs:
        missing = [key for key in ("table", "row", "anchor", "note") if not spec.get(key)]
        if missing:
            raise Refused(f"a spec is missing {', '.join(missing)}: {spec!r}")
        by_table.setdefault(str(spec["table"]), []).append(spec)
    planned: dict[pathlib.Path, tuple[str, str, dict]] = {}
    for table, table_specs in by_table.items():
        path = root / "scripts" / "mutations" / table / "mutations.py"
        rows = table_contract.load(path)
        original = path.read_text(encoding="utf-8")
        tree = ast.parse(original)
        ids = [table_contract.row_id(row[0]) for row in rows]
        mutations = _mutations_node(tree, table)
        if len(mutations.elts) != len(rows):
            raise Refused(f"{table}: MUTATIONS holds {len(mutations.elts)} rows and loads as {len(rows)}")
        splices: list[Splice] = []
        expected: dict[str, list[tuple[str, str, str]]] = {}
        for spec in table_specs:
            rid, edit = str(spec["row"]), int(spec.get("edit", 0))
            label = f"{table} {rid}"
            if ids.count(rid) != 1:
                raise Refused(f"{label}: {ids.count(rid)} rows have that id")
            index = ids.index(rid)
            edits = expected.setdefault(rid, list(table_contract.edits_of(rows[index])))
            if not 0 <= edit < len(edits):
                raise Refused(f"{label}: it has {len(edits)} edits, and there is no edit {edit}")
            rel, _old, kept = edits[edit]
            anchor = spec["anchor"]
            replacement = spec.get("replacement")
            new = kept if replacement is None else replacement
            if new == anchor:
                raise Refused(f"{label}: the replacement is the anchor, so the row would change nothing")
            live = (root / rel).read_text(encoding="utf-8") if (root / rel).is_file() else None
            if live is None:
                raise Refused(f"{label}: {rel} does not exist under {root}")
            matches = live.count(anchor)
            if matches != 1:
                raise Refused(f"{label}: the new anchor matches {matches} times in {rel}, not once")
            anchor_node, replacement_node = _edit_fields(mutations.elts[index], edit, label)
            note = f"⚑ **{by} · re-anchored in place, not retired** — {spec['note']}"
            shared = spec.get("shared") is True
            node, readers = _literal(tree, anchor_node, "anchor", shared)
            splices.append(Splice(node, anchor, note, readers))
            if replacement is not None:
                node, readers = _literal(tree, replacement_node, "replacement", shared)
                splices.append(Splice(node, replacement, None, readers))
            edits[edit] = (rel, anchor, new)
        planned[path] = (_spliced(original, _once_each(table, splices)), original, expected)
    return planned


def _once_each(table: str, splices: list[Splice]) -> list[Splice]:
    """One splice per literal. ⛔ Two specs may meet at one literal only through a SHARED name, when
    they write the same text and between them list every place that reads it."""

    by_span: dict[tuple[int, int], list[Splice]] = {}
    for one in splices:
        by_span.setdefault((one.node.lineno, one.node.col_offset), []).append(one)
    kept: list[Splice] = []
    for group in by_span.values():
        first = group[0]
        if first.shared is None:
            if len(group) != 1:
                raise Refused(f"{table}: two specs correct the same literal")
        else:
            name, readers = first.shared
            if any(one.text != first.text for one in group):
                raise Refused(f"{table}: the specs correct the shared {name} to different text")
            if len(group) != readers:
                raise Refused(
                    f"{table}: {name} is read in {readers} places and {len(group)} specs correct it "
                    "— list every row that reads it"
                )
        notes = [one.note for one in group if one.note]
        kept.append(Splice(first.node, first.text, notes[0] if notes else None, first.shared))
    return kept


def _spliced(source: str, splices: list[Splice]) -> str:
    """Every splice and every note, made in ONE pass over the original source's byte offsets.

    ⚠️ **Placed by the original offsets, all of them, from the bottom up** (review of `716`, twice). A
    literal written over several lines becomes ONE (``json.dumps`` escapes its newlines), so a note
    placed afterwards by line number landed above the wrong line; and a note inserted at a line's
    start in the middle of the pass moved every literal to its LEFT on that line. So splices and
    notes are one list of edits by original offset, applied highest first — each touches only bytes
    at or after its own offset — and at one offset a splice goes before the note (a literal at
    column 0 keeps its note above it).
    """

    lines = _lines(source)
    edits: list[tuple[int, int, int, bytes]] = []  # (start, splice-before-note, end, bytes)
    for one in splices:
        start = _offset(lines, one.node.lineno, one.node.col_offset)
        end = _offset(lines, one.node.end_lineno, one.node.end_col_offset)
        edits.append((start, 1, end, json.dumps(one.text, ensure_ascii=False).encode("utf-8")))
        if one.note:
            line_start = _offset(lines, one.node.lineno, 0)
            line = lines[one.node.lineno - 1]
            indent = line[: len(line) - len(line.lstrip(b" "))]
            edits.append((line_start, 0, line_start, indent + f"# {one.note}\n".encode("utf-8")))
    encoded = source.encode("utf-8")
    for start, _order, end, text in sorted(edits, key=lambda edit: (edit[0], edit[1]), reverse=True):
        encoded = encoded[:start] + text + encoded[end:]
    return encoded.decode("utf-8")


def _reads_back(
    root: pathlib.Path, path: pathlib.Path, before: list, expected: dict[str, list]
) -> str | None:
    """Why the written table does not read back as planned, or None when it does — its rows as the
    contract loads them, and each corrected row through the contract's own dry apply."""

    try:
        after = table_contract.load(path)
    except ValueError as error:
        return f"it no longer loads: {error}"
    if len(after) != len(before):
        return f"it holds {len(after)} rows, not {len(before)}"
    for index, (old, new) in enumerate(zip(before, after)):
        rid = table_contract.row_id(old[0])
        if new[0] != old[0]:
            return f"{rid}'s label moved"
        want = expected.get(rid, table_contract.edits_of(old))
        if list(table_contract.edits_of(new)) != list(want):
            return f"{rid}'s edits are not the planned ones"
        if rid in expected:
            # ⚑ The contract applies a row's edits IN ORDER, each after the one before — which a
            # count against the untouched file cannot see for a row with two edits on one file.
            try:
                table_contract.apply_row(after, root, index, dry=True)
            except (ValueError, OSError) as error:
                return f"{rid} does not apply: {error}"
    return None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("specs", type=pathlib.Path)
    parser.add_argument("--by", required=True, help="the dispatch that corrects them, for the note")
    parser.add_argument("--root", type=pathlib.Path, default=REPO)
    parser.add_argument("--dry-run", action="store_true")
    arguments = parser.parse_args(argv)
    root = arguments.root.resolve()
    try:
        specs = json.loads(arguments.specs.read_text(encoding="utf-8"))
        if not isinstance(specs, list) or not specs:
            raise Refused("SPECS.json must be a non-empty list")
        planned = plan(root, specs, arguments.by)
        befores = {path: table_contract.load(path) for path in planned}
    except (Refused, ValueError, OSError, SyntaxError) as error:
        print(f"REFUSED · {error} — nothing was written")
        return 2
    for spec in specs:
        print(f"{spec['table']} {spec['row']} · edit {spec.get('edit', 0)} · anchor matches once")
    if arguments.dry_run:
        print(f"DRY RUN · {len(specs)} anchors in {len(planned)} tables would be corrected")
        return 0
    # ⚑ **All or nothing, across tables** (review of `716`): the first table that does not read back
    # as planned puts EVERY table written so far back to its original bytes, and the rest are never
    # written.
    written: list[pathlib.Path] = []
    for path, (corrected, original, expected) in planned.items():
        path.write_text(corrected, encoding="utf-8")
        written.append(path)
        why = _reads_back(root, path, befores[path], expected)
        if why is not None:
            for done in written:
                done.write_text(planned[done][1], encoding="utf-8")
            print(
                f"NOT WRITTEN · {path.relative_to(root)}: {why} — every table this run wrote "
                f"({len(written)}) has its original bytes back"
            )
            return 3
    print(f"CORRECTED · {len(specs)} anchors in {len(planned)} tables — now verify_row.py each row")
    return 0


if __name__ == "__main__":
    sys.exit(main())
