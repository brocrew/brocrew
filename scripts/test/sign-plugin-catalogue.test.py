"""Only throwaway encrypted keys under this test's temporary directory are used."""

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import pty
import select
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "sign-plugin-catalogue.py"
spec = importlib.util.spec_from_file_location("signer", SCRIPT)
signer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(signer)


class ScratchSigner(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory(prefix="fictional-catalogue-key-")
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name).resolve()
        self.program = shutil.which("openssl")
        self.assertIsNotNone(self.program)
        self.secret = b"fictional-test-passphrase\n"
        self.key_folder = self.root / "keys"
        self.key_folder.mkdir(mode=0o700)
        self.key = self.key_folder / "private.pem"
        self.public = self.root / "public.pem"
        self.catalogue = self.root / "catalogue.json"
        # Whitespace and Unicode must survive: signing parsed/reformatted JSON would fail verification.
        self.original = (json.dumps({
            "format": 1,
            "entries": [{
                "id": "page-reader", "version": "0.1.0", "sourceCommit": "ab" * 20,
                "platforms": [{"os": "darwin", "cpu": "arm64"}],
                "archive": {
                    "url": "https://releases.example.invalid/page-reader.tar",
                    "size": 1, "sha256": "00" * 32, "compression": "tar",
                },
                "manifestSha256": "11" * 32, "description": "Read caf\u00e9 pages.",
            }],
        }, ensure_ascii=False, indent=1) + "\n").encode("utf-8")
        self.catalogue.write_bytes(self.original)
        self.expected = hashlib.sha256(self.original).hexdigest()
        self.command([
            "genpkey", "-algorithm", "ED25519", "-aes-256-cbc", "-pass", "stdin", "-out", str(self.key)
        ], self.secret)
        self.command([
            "pkey", "-in", str(self.key), "-passin", "stdin", "-pubout", "-out", str(self.public)
        ], self.secret)
        self.key.chmod(0o600)

    def command(self, args, password=None):
        result = subprocess.run(
            [self.program, *args], input=password, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, timeout=5, check=False,
        )
        self.assertEqual(result.returncode, 0)
        return result.stdout

    def sign(self, expected=None, password="fictional-test-passphrase"):
        with patch.object(sys.stdin, "isatty", return_value=True), patch.object(
            signer.getpass, "getpass", return_value=password
        ):
            signer.sign_catalogue(
                self.catalogue, expected or self.expected, self.key, self.public, self.program
            )

    def test_exact_bytes_and_raw_signature(self):
        self.sign()
        signature = self.root / "catalogue.sig"
        self.assertEqual(signature.stat().st_size, 64)
        self.command([
            "pkeyutl", "-verify", "-rawin", "-pubin", "-inkey", str(self.public),
            "-sigfile", str(signature), "-in", str(self.catalogue),
        ])
        self.assertEqual(self.catalogue.read_bytes(), self.original)
        self.assertFalse(any(item.name.startswith(".catalogue-sign-") for item in self.root.iterdir()))

    def refuse_before_prompt(self):
        with patch.object(sys.stdin, "isatty", return_value=True), patch.object(
            signer.getpass, "getpass", side_effect=AssertionError("must not prompt")
        ) as prompt:
            with self.assertRaisesRegex(ValueError, "owned regular key"):
                signer.sign_catalogue(self.catalogue, self.expected, self.key, self.public, self.program)
            prompt.assert_not_called()
        self.assertFalse((self.root / "catalogue.sig").exists())

    def test_symlinked_key_is_refused_before_prompt(self):
        original = self.key.with_name("original.pem")
        self.key.rename(original)
        self.key.symlink_to(original)
        self.refuse_before_prompt()

    def test_symlinked_key_folder_is_refused_before_prompt(self):
        original = self.root / "original-keys"
        self.key_folder.rename(original)
        self.key_folder.symlink_to(original, target_is_directory=True)
        self.refuse_before_prompt()

    def test_readable_key_is_refused_before_prompt(self):
        self.key.chmod(0o644)
        self.refuse_before_prompt()

    def test_symlinked_ancestor_is_refused_before_prompt(self):
        alias = self.root / "alias"
        alias.symlink_to(self.root, target_is_directory=True)
        self.key = alias / "keys/private.pem"
        self.refuse_before_prompt()

    def test_loose_key_folder_is_refused_before_prompt(self):
        self.key_folder.chmod(0o755)
        self.refuse_before_prompt()

    def test_non_regular_key_is_refused_before_prompt_without_blocking(self):
        self.key.unlink()
        os.mkfifo(self.key, 0o600)
        self.refuse_before_prompt()

    def test_wrong_key_owner_is_refused_before_prompt(self):
        actual = os.fstat
        def foreign(fd):
            info = actual(fd)
            if stat.S_ISREG(info.st_mode):
                fields = list(info)
                fields[4] = os.getuid() + 1
                return os.stat_result(fields)
            return info
        with patch.object(signer.os, "fstat", foreign):
            self.refuse_before_prompt()

    def test_key_swapped_after_fstat_is_refused_before_prompt(self):
        actual = os.fstat
        swapped = False
        def replace_after_check(fd):
            nonlocal swapped
            info = actual(fd)
            if stat.S_ISREG(info.st_mode) and not swapped:
                swapped = True
                self.key.rename(self.key.with_name("original.pem"))
                self.key.write_bytes(b"fictional replacement")
                self.key.chmod(0o600)
            return info
        with patch.object(signer.os, "fstat", replace_after_check):
            self.refuse_before_prompt()
        self.assertTrue(swapped)

    def test_wrong_folder_owner_is_refused_before_prompt(self):
        actual = os.fstat
        inode = self.key_folder.stat().st_ino
        def foreign(fd):
            info = actual(fd)
            if info.st_ino == inode:
                fields = list(info)
                fields[4] = os.getuid() + 1
                return os.stat_result(fields)
            return info
        with patch.object(signer.os, "fstat", foreign):
            self.refuse_before_prompt()

    def test_openssl_receives_the_checked_descriptor_not_the_key_path(self):
        actual = signer.openssl_run
        seen = []
        def capture(program, arguments, password=None, pass_fds=()):
            if "-sign" in arguments:
                self.assertEqual(len(pass_fds), 1)
                self.assertEqual(arguments[arguments.index("-inkey") + 1], f"/dev/fd/{pass_fds[0]}")
                self.assertNotIn(str(self.key), arguments)
                self.assertEqual(os.fstat(pass_fds[0]).st_ino, self.key.stat().st_ino)
                seen.append(pass_fds[0])
            return actual(program, arguments, password, pass_fds)
        with patch.object(signer, "openssl_run", capture):
            self.sign()
        self.assertEqual(len(seen), 1)
        with self.assertRaises(OSError):
            os.fstat(seen[0])

    def test_wrong_hash_never_prompts_or_opens_a_key(self):
        self.key.unlink()
        with patch.object(signer.getpass, "getpass", side_effect=AssertionError("must not prompt")):
            with self.assertRaisesRegex(ValueError, "reviewed SHA-256"):
                signer.sign_catalogue(self.catalogue, "00" * 32, self.key, self.public, self.program)
        self.assertFalse((self.root / "catalogue.sig").exists())

    def test_wrong_passphrase_publishes_nothing(self):
        with self.assertRaisesRegex(ValueError, "refused"):
            self.sign(password="fictional-wrong-passphrase")
        self.assertFalse((self.root / "catalogue.sig").exists())

    def test_wrong_public_key_publishes_nothing(self):
        other = self.root / "other.pem"
        self.command(["genpkey", "-algorithm", "ED25519", "-out", str(other)])
        self.command(["pkey", "-in", str(other), "-pubout", "-out", str(self.public)])
        with self.assertRaisesRegex(ValueError, "refused"):
            self.sign()
        self.assertFalse((self.root / "catalogue.sig").exists())

    def test_existing_signature_is_never_overwritten(self):
        output = self.root / "catalogue.sig"
        output.write_bytes(b"keep")
        with self.assertRaisesRegex(ValueError, "already exists"):
            self.sign()
        self.assertEqual(output.read_bytes(), b"keep")

    def test_a_changed_catalogue_during_prompt_is_not_published(self):
        def changed(_):
            self.catalogue.write_bytes(b"changed")
            return "fictional-test-passphrase"
        with patch.object(sys.stdin, "isatty", return_value=True), patch.object(signer.getpass, "getpass", changed):
            with self.assertRaisesRegex(ValueError, "changed while signing"):
                signer.sign_catalogue(self.catalogue, self.expected, self.key, self.public, self.program)
        self.assertFalse((self.root / "catalogue.sig").exists())

    def test_no_terminal_is_refused_before_prompt(self):
        with patch.object(sys.stdin, "isatty", return_value=False), patch.object(
            signer.getpass, "getpass", side_effect=AssertionError("must not prompt")
        ):
            with self.assertRaisesRegex(ValueError, "terminal"):
                signer.sign_catalogue(self.catalogue, self.expected, self.key, self.public, self.program)

    def test_invalid_arguments_do_not_echo_their_values(self):
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--passphrase", "fictional-mistyped-value"],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5,
        )
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, b"")
        self.assertEqual(result.stderr, b"Invalid signing arguments; use --help for usage\n")

    @unittest.skipUnless(os.name == "posix", "a hidden terminal prompt needs a POSIX terminal")
    def test_real_terminal_prompt_does_not_echo_the_passphrase(self):
        pid, terminal = pty.fork()
        if pid == 0:
            os.execv(sys.executable, [
                sys.executable, str(SCRIPT), "--catalogue", str(self.catalogue),
                "--expected-sha256", self.expected, "--key", str(self.key),
                "--public-key", str(self.public), "--openssl", self.program,
            ])
        output = b""
        sent = False
        deadline = time.monotonic() + 10
        status = None
        try:
            while time.monotonic() < deadline:
                if select.select([terminal], [], [], 0.1)[0]:
                    try:
                        chunk = os.read(terminal, 4096)
                    except OSError:
                        break
                    if not chunk:
                        break
                    output += chunk
                    if b"passphrase: " in output and not sent:
                        os.write(terminal, self.secret)
                        sent = True
                got, status = os.waitpid(pid, os.WNOHANG)
                if got:
                    pid = None
                    break
            if pid is not None:
                got, status = os.waitpid(pid, os.WNOHANG)
                if not got:
                    os.kill(pid, 9)
                    os.waitpid(pid, 0)
                    self.fail("signer did not finish its terminal interaction")
                pid = None
        finally:
            if pid is not None:
                os.kill(pid, 9)
                os.waitpid(pid, 0)
            os.close(terminal)
        self.assertEqual(os.waitstatus_to_exitcode(status), 0)
        self.assertEqual(output.replace(b"\r\n", b"\n"), b"Catalogue key passphrase: \nsigned and verified\n")
        self.assertNotIn(self.secret.strip(), output)
        self.assertEqual((self.root / "catalogue.sig").stat().st_size, 64)


if __name__ == "__main__":
    unittest.main()
