package main

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"errors"
	"fmt"
	"strings"
	"testing"
)

func TestArchiveEntryNamesThatAreRefused(t *testing.T) {
	denied := []string{
		".ssh/id_rsa", "proj/.ssh/config", "id_ed25519", "keys/id_rsa", ".env", "app/.env.production", "serpapi-auth/credentials.json", "x/gmail-auth/",
		"token.json", "config/tokens", "data/oauth-token.json", ".aws/credentials", "a/.gnupg/pubring.kbx", ".kube/config", ".netrc", ".npmrc", ".git-credentials",
		"certs/server.pem", "priv.key", "bundle.p12", "vault.kdbx", "secrets/db", "client_secret_1.json", "service-account-prod.json", "passwords.txt", "cookies.sqlite",
		"Library/Keychains/login.keychain-db", "/abs/path", "C:\\Windows\\x", "dir\\.ssh\\id_rsa", "ＩＤ_rsa",
		// the path guard's dotfiles and more: any hidden folder, hidden files off the short allowed list, databases, histories
		".codex/auth.json", ".claude/.credentials.json", ".claude.json", ".config/gh/hosts.yml", "gh/hosts.yml", ".git/config", "repo/.git/config",
		".zsh_history", "x/.bash_history", "home/zsh_history", "Library/Messages/chat.db", "x/Library/Keychains/y",
		"workspace/whatsapp-mcp/messages.db", "data/app.sqlite", "data/app.sqlite3", "auth.json", "gcp-credentials.json", "prod_credentials_v2.json",
		"oauth-auth.json", "dir/.hidden", ".AWS/credentials",
		// allowed project folders do not shield credential-looking names, hidden folders inside them, or paths that climb out
		".github/../.ssh/id_rsa", ".vscode/secrets.json", ".github/token.txt", ".github/credentials.json", ".vscode/.env", ".github/deploy.pem",
		".vscode/id_rsa", ".github/auth.json", ".github/secrets/x.yml", ".github/.hidden/x", "../.github/x", ".github/../../x", ".github//.ssh/id_rsa",
		".github\\..\\.ssh\\id_rsa", "a/b/../../../x", ".git/config", ".git/hooks/pre-commit", "proj/.git/config", ".github/mytoken.yml",
		".github/workflows/deploy-secret.yml", ".vscode/tasks/.npmrc", ".github.bak/x",
	}
	for _, name := range denied {
		if archiveEntryDenied(name) == "" {
			t.Fatalf("%q was not refused", name)
		}
	}
	fine := []string{
		"src/index.js", "app/Setup.exe", "README.md", "__MACOSX/._x", ".DS_Store", "tokenizer/vocab.txt", "lib/session.js", "id_rsa.pub", "docs/authors.txt",
		"My.app/Contents/MacOS/My", "node_modules/left-pad/index.js", "assets/env.png",
		"Thumbs.db", ".gitignore", "src/.gitignore", "./bin/app", "./", ".", "__MACOSX/._x", "app/Contents/Library/LaunchServices/x", "dbx/file.dbx",
		"docs/history.md", "src/.DS_Store",
		".github/workflows/ci.yml", "proj/.github/ISSUE_TEMPLATE/bug.md", "./.github/x.yml", ".gitattributes", ".editorconfig", "proj/.editorconfig",
		".vscode/settings.json", "proj/.vscode/launch.json", ".vscode/extensions.json", "a/../b", "a//b///c.txt", "./src/./index.js", "a/b/../c.txt",
		".github/CODEOWNERS", ".github/dependabot.yml", ".github/",
	}
	for _, name := range fine {
		if why := archiveEntryDenied(name); why != "" {
			t.Fatalf("%q was refused: %s", name, why)
		}
	}
}

func TestTarNamesLongNamesAndBudget(t *testing.T) {
	long := strings.Repeat("deep/", 30) + ".ssh/id_rsa" // longer than the 100 bytes of a plain tar name: carried as a PAX/GNU record
	names, err := tarNames(bytes.NewReader(makeTar(t, "a", long, "z")))
	if err != nil || len(names) != 3 || names[1] != long {
		t.Fatalf("long names were not read: %v %v", names, err)
	}
	if !anyEntryDenied(names) {
		t.Fatal("a credential name behind a long path was missed")
	}
	if _, err := tarNames(bytes.NewReader(nil)); err == nil {
		t.Fatal("an empty stream was taken for a tar")
	}
	if _, err := tarGzNames(bytes.NewReader(gz(t, []byte(strings.Repeat("not a tar ", 100))))); err == nil {
		t.Fatal("a gzip of text was taken for a tar.gz")
	}
	if _, err := tarGzNames(bytes.NewReader([]byte{0x1f, 0x8b, 8, 0, 1, 2, 3})); err == nil {
		t.Fatal("a damaged gzip was accepted")
	}
	good, err := tarGzNames(bytes.NewReader(gz(t, makeTar(t, "bin/app", "bin/lib"))))
	if err != nil || len(good) != 2 {
		t.Fatalf("a good tar.gz: %v %v", good, err)
	}
	// the budget: a stream longer than it ends in an error, not in a long read
	r := &budgetReader{r: bytes.NewReader(make([]byte, 100)), left: 10}
	if _, err := bytes.NewBuffer(nil).ReadFrom(r); !errors.Is(err, errScanBudget) {
		t.Fatalf("the budget did not stop the read: %v", err)
	}
	var buf bytes.Buffer
	w := tar.NewWriter(&buf)
	_ = w.WriteHeader(&tar.Header{Name: "x", Size: 0, Typeflag: tar.TypeReg})
	_ = w.Close()
	if names, err := tarNames(&buf); err != nil || len(names) != 1 {
		t.Fatalf("an archive of one empty file: %v %v", names, err)
	}
}

func TestZipNamesReadsTheDirectoryOnly(t *testing.T) {
	data := makeZip(t, "a.txt", "b/.ssh/id_rsa")
	names, err := zipNames(bytes.NewReader(data), int64(len(data)))
	if err != nil || len(names) != 2 || !anyEntryDenied(names) {
		t.Fatalf("zip names: %v %v", names, err)
	}
	if _, err := zipNames(bytes.NewReader([]byte("PK\x03\x04junk")), 8); err == nil {
		t.Fatal("a damaged zip was accepted")
	}
}

func TestDataAfterTheTarEndMarkerIsRefused(t *testing.T) {
	hidden := append(makeTar(t, "ok.txt"), makeTar(t, "home/.ssh/id_rsa")...)
	if _, err := tarNames(bytes.NewReader(hidden)); err == nil {
		t.Fatal("entries hidden behind the end marker were not refused")
	}
	if _, err := tarGzNames(bytes.NewReader(gz(t, hidden))); err == nil {
		t.Fatal("entries hidden behind the end marker of a tar.gz were not refused")
	}
	junk := append(makeTar(t, "ok.txt"), []byte(strings.Repeat("x", 600))...)
	if _, err := tarNames(bytes.NewReader(junk)); err == nil {
		t.Fatal("junk after the end marker was accepted")
	}
	padded := append(makeTar(t, "a"), make([]byte, 10240)...)
	if names, err := tarNames(bytes.NewReader(padded)); err != nil || len(names) != 1 {
		t.Fatalf("ordinary padding after the end marker was refused: %v %v", names, err)
	}
}

func TestTheCapsArePinned(t *testing.T) {
	if fileMaxBytes != 100<<20 || imageMaxBytes != 16<<20 || audioMaxBytes != 64<<20 || videoMaxBytes != 64<<20 {
		t.Fatalf("a size cap moved: file %d image %d audio %d video %d", int64(fileMaxBytes), int64(imageMaxBytes), int64(audioMaxBytes), int64(videoMaxBytes))
	}
	if _, ok := sniffAttachment(fakeSizedReader{head: fakePE()}, fileMaxBytes+1, "a.exe"); ok {
		t.Fatal("a file over 100 MB was accepted")
	}
	if _, ok := sniffAttachment(fakeSizedReader{head: fakePE()}, fileMaxBytes, "a.exe"); !ok {
		t.Fatal("a file of exactly 100 MB was refused")
	}
}

func TestProjectArchivesPassButGitAndCredentialsDoNot(t *testing.T) {
	ok := makeZip(t, ".github/workflows/ci.yml", "src/index.js", ".gitignore", ".editorconfig", ".vscode/settings.json", "README.md")
	if got, good := sniffBytes(ok, "proj.zip"); !good || got.Mime != "application/zip" {
		t.Fatalf("a project zip was refused: %v %+v", good, got)
	}
	if got, good := sniffBytes(makeTar(t, "proj/.github/workflows/ci.yml", "proj/.gitattributes"), "proj.tar"); !good || got.Mime != "application/x-tar" {
		t.Fatalf("a project tar was refused: %v %+v", good, got)
	}
	for _, names := range [][]string{{".git/config"}, {".github/../.ssh/id_rsa"}, {".vscode/secrets.json"}, {".github/token.txt"}, {"src/a.js", ".github/workflows/ci.yml", ".git/HEAD"}} {
		if _, good := sniffBytes(makeZip(t, names...), "proj.zip"); good {
			t.Fatalf("%v was accepted", names)
		}
	}
}

func TestAZipThatNamesAnEntryDifferentlyInItsHeaderIsRefused(t *testing.T) {
	data := makeZip(t, "okay/xx.txt", "src/a.js")
	if names, err := zipNames(bytes.NewReader(data), int64(len(data))); err != nil || len(names) != 2 {
		t.Fatalf("a good zip: %v %v", names, err)
	}
	// the local header of the first entry says ".ssh/id_rsa" (same length as "okay/xx.txt" is not needed: pad the name to the same size)
	local := []byte(".ssh/id_rsa")
	central := []byte("okay/xx.txt")
	if len(local) != len(central) {
		t.Fatal("test names must have the same length")
	}
	forged := bytes.Replace(data, central, local, 1) // the first occurrence is the local header
	if !bytes.Contains(forged, central) {
		t.Fatal("the directory copy must still say the original name")
	}
	if _, err := zipNames(bytes.NewReader(forged), int64(len(forged))); !errors.Is(err, errZipNameMismatch) {
		t.Fatalf("a header that disagrees with the directory was accepted: %v", err)
	}
	if _, ok := sniffBytes(forged, "x.zip"); ok {
		t.Fatal("the zip with a forged header name was sent")
	}
	broken := append([]byte(nil), data...)
	broken[0], broken[1], broken[2], broken[3] = 0, 0, 0, 0
	if _, err := zipNames(bytes.NewReader(broken), int64(len(broken))); err == nil {
		t.Fatal("a damaged local header was accepted")
	}
}

func TestZip64ArchivesAreReadToo(t *testing.T) {
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	for i := 0; i < 65600; i++ { // more than 65535 entries: the writer emits a zip64 directory
		if _, err := w.Create(fmt.Sprintf("d/f%d", i)); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	names, err := zipNames(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err != nil || len(names) != 65600 {
		t.Fatalf("zip64: %d names, %v", len(names), err)
	}
}

func makeTarLinks(t *testing.T, headers ...tar.Header) []byte {
	t.Helper()
	var buf bytes.Buffer
	w := tar.NewWriter(&buf)
	for _, h := range headers {
		h.Mode = 0o644
		if h.Typeflag == 0 || h.Typeflag == tar.TypeReg {
			h.Typeflag = tar.TypeReg
			h.Size = 2
		}
		if err := w.WriteHeader(&h); err != nil {
			t.Fatal(err)
		}
		if h.Size > 0 {
			_, _ = w.Write([]byte("hi"))
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestTarLinksAreChecked(t *testing.T) {
	sym := func(name, link string) tar.Header {
		return tar.Header{Name: name, Linkname: link, Typeflag: tar.TypeSymlink}
	}
	hard := func(name, link string) tar.Header {
		return tar.Header{Name: name, Linkname: link, Typeflag: tar.TypeLink}
	}
	bad := [][]tar.Header{
		{sym("home/link", "../.ssh/id_rsa")}, {sym("link", "/etc/passwd")}, {sym("a/b/link", "../../../outside")}, {sym("link", ".ssh/id_rsa")},
		{sym("d/link", "../.aws/credentials")}, {hard("hard", ".ssh/id_rsa")}, {hard("hard", "/etc/passwd")}, {hard("hard", "../x")},
		{sym("l", "C:\\Windows\\x")}, {sym("l", strings.Repeat("sub/", 30)+strings.Repeat("../", 40)+".ssh/id_rsa")},
	}
	for _, headers := range bad {
		if _, err := tarNames(bytes.NewReader(makeTarLinks(t, headers...))); err == nil {
			t.Fatalf("%v was accepted", headers)
		}
		if _, ok := sniffBytes(makeTarLinks(t, headers...), "x.tar"); ok {
			t.Fatalf("%v was sent", headers)
		}
	}
	file := tar.Header{Name: "bin/tool-1.2"}
	for _, links := range [][]tar.Header{{sym("bin/tool", "tool-1.2")}, {sym("lib/libx.so", "../shared/libx.so.1")}, {hard("copy", "bin/tool")}, {sym("root-link", ".")}} {
		if _, err := tarNames(bytes.NewReader(makeTarLinks(t, append([]tar.Header{file}, links...)...))); err != nil {
			t.Fatalf("%v was refused: %v", links, err)
		}
	}
	if linkTargetDenied("a/link", "../b/c", true) != "" || linkTargetDenied("a/link", "../../b", true) == "" || linkTargetDenied("a/link", "../b", false) == "" {
		t.Fatal("link target resolution is off")
	}
}

func TestTheAllowedFoldersAndLibraryGaps(t *testing.T) {
	for _, name := range []string{".github", ".vscode", "proj/.github", ".github/.foo/bar", ".vscode/.cache/x", ".github/workflows/.hidden/ci.yml", ".github/.hidden",
		"Library/Caches/x.txt", "Library/Preferences/com.example.plist", "home/Library/Mail/inbox.txt", "home/Library/Application Support/App/x.txt", "Library"} {
		if archiveEntryDenied(name) == "" {
			t.Fatalf("%q was not refused", name)
		}
	}
	for _, name := range []string{".github/", "app/Contents/Library/LaunchServices/x"} {
		if why := archiveEntryDenied(name); why != "" {
			t.Fatalf("%q was refused: %s", name, why)
		}
	}
}
