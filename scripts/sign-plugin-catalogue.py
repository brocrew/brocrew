#!/usr/bin/env python3
"""Sign reviewed catalogue bytes locally; OpenSSL alone opens the private key."""

import argparse
from contextlib import contextmanager
import getpass
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import stat
import sys
import tempfile
import warnings


class SigningArguments(argparse.ArgumentParser):
    def error(self, message):
        # A mistyped option must not echo a value the person accidentally put in the command.
        self.exit(2, "Invalid signing arguments; use --help for usage\n")


KEY_REFUSAL = "Use an owned regular key with mode 0600 in an owned 0700 folder, with no links or replacements"


@contextmanager
def admitted_key(key):
    """Anchor every path component and retain the checked key until OpenSSL exits."""
    descriptors = []
    try:
        key = Path(key)
        if not key.is_absolute() or ".." in key.parts:
            raise ValueError(KEY_REFUSAL)
        flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC
        current = os.open(key.anchor, flags | os.O_DIRECTORY)
        descriptors.append(current)
        links = []
        for name in key.parts[1:-1]:
            child = os.open(name, flags | os.O_DIRECTORY, dir_fd=current)
            descriptors.append(child)
            links.append((current, name, child))
            current = child
        parent_info = os.fstat(current)
        if parent_info.st_uid != os.getuid() or stat.S_IMODE(parent_info.st_mode) != 0o700:
            raise ValueError(KEY_REFUSAL)
        fd = os.open(key.name, flags | os.O_NONBLOCK, dir_fd=current)
        descriptors.append(fd)
        info = os.fstat(fd)
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_uid != os.getuid()
            or stat.S_IMODE(info.st_mode) != 0o600
        ):
            raise ValueError(KEY_REFUSAL)

        def unchanged():
            for parent, name, child in [*links, (current, key.name, fd)]:
                named = os.stat(name, dir_fd=parent, follow_symlinks=False)
                opened = os.fstat(child)
                if (named.st_dev, named.st_ino) != (opened.st_dev, opened.st_ino):
                    raise ValueError(KEY_REFUSAL)
            if os.fstat(fd) != info or os.fstat(current) != parent_info:
                raise ValueError(KEY_REFUSAL)

        unchanged()
        yield fd, unchanged
    except OSError:
        raise ValueError(KEY_REFUSAL) from None
    finally:
        for descriptor in reversed(descriptors):
            os.close(descriptor)


def openssl_run(program, arguments, password=None, pass_fds=()):
    try:
        result = subprocess.run(
            [program, *arguments],
            input=password,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=30,
            check=False,
            env={"PATH": "/usr/bin:/bin", "OPENSSL_CONF": os.devnull},
            pass_fds=pass_fds,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise ValueError("OpenSSL could not complete the operation") from None
    if result.returncode != 0:
        raise ValueError("OpenSSL refused the key, passphrase or signature")
    return result.stdout


def sign_catalogue(catalogue, expected, key, public_key, program):
    if not re.fullmatch(r"[a-f0-9]{64}", expected):
        raise ValueError("Supply the reviewed catalogue SHA-256")
    original = catalogue.read_bytes()
    if hashlib.sha256(original).hexdigest() != expected:
        raise ValueError("The catalogue does not match the reviewed SHA-256")
    try:
        value = json.loads(original.decode("utf-8"))
    except (UnicodeError, ValueError):
        raise ValueError("The catalogue must be UTF-8 JSON") from None
    if (
        not isinstance(value, dict)
        or value.get("format") != 1
        or not isinstance(value.get("entries"), list)
    ):
        raise ValueError("The catalogue must have format 1 and entries")
    output = catalogue.with_name("catalogue.sig")
    if output.exists() or output.is_symlink():
        raise ValueError("catalogue.sig already exists; keep the previous signature")
    if not sys.stdin.isatty():
        raise ValueError("Run the signer in a terminal for its hidden passphrase prompt")
    with admitted_key(key) as (key_fd, unchanged):
        sign_admitted(catalogue, original, output, key_fd, unchanged, public_key, program)


def sign_admitted(catalogue, original, output, key_fd, unchanged, public_key, program):
    # No fallback that echoes the passphrase if a controlling terminal is unavailable.
    unchanged()
    with warnings.catch_warnings():
        warnings.simplefilter("error", getpass.GetPassWarning)
        password = getpass.getpass("Catalogue key passphrase: ")
    if not password or "\n" in password or "\r" in password or "\0" in password:
        raise ValueError("Use a nonempty single-line passphrase")
    try:
        secret = bytearray(password.encode("utf-8") + b"\n")
    except UnicodeError:
        raise ValueError("Use a UTF-8 passphrase") from None
    del password
    try:
        with tempfile.TemporaryDirectory(prefix="catalogue-sign-") as folder:
            snapshot = Path(folder) / "catalogue.json"
            signature_file = Path(folder) / "catalogue.sig"
            snapshot.write_bytes(original)
            snapshot.chmod(0o600)
            unchanged()
            signature = openssl_run(
                program,
                ["pkeyutl", "-sign", "-rawin", "-inkey", f"/dev/fd/{key_fd}",
                 "-passin", "stdin", "-in", str(snapshot)],
                secret,
                pass_fds=(key_fd,),
            )
            if len(signature) != 64:
                raise ValueError("Expected a raw 64-byte Ed25519 signature")
            signature_file.write_bytes(signature)
            signature_file.chmod(0o600)
            # A 64-byte result alone does not prove Ed25519: require its SPKI algorithm identifier.
            public_der = openssl_run(
                program, ["pkey", "-pubin", "-in", str(public_key), "-outform", "DER"]
            )
            if (
                len(public_der) != 44
                or public_der[:12] != bytes.fromhex("302a300506032b6570032100")
            ):
                raise ValueError("The public key must be Ed25519")
            openssl_run(
                program,
                ["pkeyutl", "-verify", "-rawin", "-pubin", "-inkey", str(public_key),
                 "-sigfile", str(signature_file), "-in", str(snapshot)],
            )
            if catalogue.read_bytes() != original:
                raise ValueError("The catalogue changed while signing; no signature was published")
            # A hard link publishes the complete verified signature without replacing an existing file.
            staged = catalogue.parent / (".catalogue-sign-" + os.urandom(12).hex())
            try:
                with staged.open("xb") as handle:
                    handle.write(signature)
                    handle.flush()
                    os.fsync(handle.fileno())
                staged.chmod(0o600)
                os.link(staged, output)
            finally:
                staged.unlink(missing_ok=True)
    finally:
        secret[:] = b"\0" * len(secret)


def main():
    parser = SigningArguments(description=__doc__)
    parser.add_argument("--catalogue", required=True, type=Path)
    parser.add_argument("--expected-sha256", required=True)
    parser.add_argument("--public-key", required=True, type=Path)
    parser.add_argument("--key", type=Path, default=Path.home() / ".brocrew-signing/catalogue.pem")
    parser.add_argument("--openssl", default="/opt/homebrew/bin/openssl")
    args = parser.parse_args()
    try:
        sign_catalogue(
            args.catalogue, args.expected_sha256, args.key, args.public_key, args.openssl
        )
    except (ValueError, OSError, EOFError, KeyboardInterrupt, getpass.GetPassWarning) as error:
        # Never echo a path, a child error stack or anything that could contain key material.
        message = (
            str(error) if isinstance(error, ValueError)
            else "Signing did not complete; no new signature was published"
        )
        print(message, file=sys.stderr)
        return 1
    print("signed and verified")
    return 0


if __name__ == "__main__":
    sys.exit(main())
