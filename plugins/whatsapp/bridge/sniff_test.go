package main

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestGroupLimiterHourlyCap(t *testing.T) {
	limiter := &groupLimiter{}
	now := time.Now()
	for i := 0; i < groupSendHourlyLimit; i++ {
		if !limiter.reserve(now.Add(time.Duration(i) * 3 * time.Second)) {
			t.Fatalf("reserve %d refused too early", i)
		}
	}
	if limiter.reserve(now.Add(10 * time.Minute)) {
		t.Fatal("hourly cap not enforced")
	}
	if !limiter.reserve(now.Add(61 * time.Minute)) {
		t.Fatal("cap did not expire")
	}
}

func TestMediaDirectPathKeepsTheQuery(t *testing.T) {
	got := mediaDirectPath("https://mmg.whatsapp.net/v/t62.7118-24/1234_n.enc?ccb=11-4&oh=abc&oe=def")
	if got != "/v/t62.7118-24/1234_n.enc?ccb=11-4&oh=abc&oe=def" {
		t.Fatalf("direct path lost its query: %q", got)
	}
	if mediaDirectPath("not a whatsapp url") != "not a whatsapp url" {
		t.Fatal("unexpected rewrite")
	}
}

type fakeTransport struct {
	body          io.Reader
	contentLength int64
	closed        bool
}

func (f *fakeTransport) RoundTrip(*http.Request) (*http.Response, error) {
	return &http.Response{StatusCode: 200, ContentLength: f.contentLength, Body: io.NopCloser(f.body), Header: http.Header{}}, nil
}

// endless serves zeros forever: what a hostile CDN could do when a sender controls the declared length.
type endless struct{ served int64 }

func (e *endless) Read(p []byte) (int, error) {
	for i := range p {
		p[i] = 0
	}
	e.served += int64(len(p))
	return len(p), nil
}

func TestMediaTransportBoundsTheBodyWhateverIsDeclared(t *testing.T) {
	const limit = 1024
	// 1. an endless body with an unknown length: reading stops at the limit with an error, never buffering more
	source := &endless{}
	client := &http.Client{Transport: limitedTransport{base: &fakeTransport{body: source, contentLength: -1}, limit: limit}}
	resp, err := client.Get("http://example.invalid/x")
	if err != nil {
		t.Fatal(err)
	}
	data, err := io.ReadAll(resp.Body)
	if !errors.Is(err, errMediaTooLarge) || len(data) > limit {
		t.Fatalf("endless body not bounded: %d bytes, err=%v", len(data), err)
	}
	if source.served > limit+4096 {
		t.Fatalf("read far past the limit: %d", source.served)
	}
	// 2. a declared length over the limit is refused before reading
	big := &endless{}
	client = &http.Client{Transport: limitedTransport{base: &fakeTransport{body: big, contentLength: limit + 1}, limit: limit}}
	if _, err := client.Get("http://example.invalid/x"); err == nil || big.served != 0 {
		t.Fatal("an over-limit Content-Length was not refused unread")
	}
	// 3. a declared length that lies (small header, big body) is still bounded
	liar := &endless{}
	client = &http.Client{Transport: limitedTransport{base: &fakeTransport{body: liar, contentLength: 10}, limit: limit}}
	resp, err = client.Get("http://example.invalid/x")
	if err != nil {
		t.Fatal(err)
	}
	if data, err := io.ReadAll(resp.Body); !errors.Is(err, errMediaTooLarge) || len(data) > limit {
		t.Fatalf("a lying Content-Length was trusted: %d bytes", len(data))
	}
	// 4. a body of exactly the limit is delivered whole
	exact := strings.Repeat("a", limit)
	client = &http.Client{Transport: limitedTransport{base: &fakeTransport{body: strings.NewReader(exact), contentLength: limit}, limit: limit}}
	resp, err = client.Get("http://example.invalid/x")
	if err != nil {
		t.Fatal(err)
	}
	if data, err := io.ReadAll(resp.Body); err != nil || len(data) != limit {
		t.Fatalf("an at-limit body was damaged: %d bytes, err=%v", len(data), err)
	}
}

// ── attachments ───────────────────────────────────────────────────────────────────────────────────────────────────────────

func makeZip(t *testing.T, names ...string) []byte {
	t.Helper()
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	for _, n := range names {
		f, err := w.Create(n)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = f.Write([]byte("<x/>"))
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func sniffBytes(data []byte, name string) (attachType, bool) {
	return sniffAttachment(bytes.NewReader(data), int64(len(data)), name)
}

func fakePE() []byte {
	out := make([]byte, 0x40+4+60)
	copy(out, "MZ")
	out[0x3c] = 0x40
	copy(out[0x40:], "PE\x00\x00")
	return out
}

func fakeFtyp(brand string) []byte {
	out := make([]byte, 80)
	out[3] = 80
	copy(out[4:], "ftyp")
	copy(out[8:], brand)
	return out
}

func makeTar(t *testing.T, names ...string) []byte {
	t.Helper()
	var buf bytes.Buffer
	w := tar.NewWriter(&buf)
	for _, n := range names {
		if err := w.WriteHeader(&tar.Header{Name: n, Mode: 0o644, Size: 2, Typeflag: tar.TypeReg}); err != nil {
			t.Fatal(err)
		}
		_, _ = w.Write([]byte("hi"))
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func gz(t *testing.T, data []byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	w := gzip.NewWriter(&buf)
	_, _ = w.Write(data)
	_ = w.Close()
	return buf.Bytes()
}

func TestSniffAttachmentUsesTheBytesNotTheName(t *testing.T) {
	jpeg := []byte{0xff, 0xd8, 0xff, 0xe0, 0, 0}
	png := []byte("\x89PNG\r\n\x1a\nrest")
	webp := []byte("RIFF\x00\x00\x00\x00WEBPVP8 ")
	ogg := func(codec string) []byte {
		return append(append([]byte("OggS\x00\x02"), make([]byte, 20)...), []byte(codec+strings.Repeat("\x00", 40))...)
	}
	ole := append([]byte{0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1}, make([]byte, 100)...)
	cases := []struct {
		name, file      string
		data            []byte
		kind, mime, ext string // empty mime means "must be refused"
	}{
		{"jpeg named png", "a.png", jpeg, "image", "image/jpeg", "jpg"},
		{"png named pdf", "a.pdf", png, "image", "image/png", "png"},
		{"webp named jpg", "a.jpg", webp, "image", "image/webp", "webp"},
		{"pdf named jpg", "a.jpg", []byte("%PDF-1.7\n"), "document", "application/pdf", "pdf"},
		{"docx", "a.zip", makeZip(t, "[Content_Types].xml", "word/document.xml"), "document", mimeDOCX, "docx"},
		{"xlsx", "a.docx", makeZip(t, "[Content_Types].xml", "xl/workbook.xml"), "document", mimeXLSX, "xlsx"},
		{"txt", "a.txt", []byte("hello\nworld\n"), "document", "text/plain", "txt"},
		{"csv", "a.csv", []byte("a,b\n1,2\n"), "document", "text/csv", "csv"},
		{"html", "a.htm", []byte("<!doctype html><p>hi"), "document", "text/html", "html"},
		{"svg", "a.svg", []byte("<svg xmlns='x'/>"), "document", "image/svg+xml", "svg"},
		{"mp3 with a tag", "song.bin", append([]byte("ID3\x04"), make([]byte, 30)...), "audio", "audio/mpeg", "mp3"},
		{"mp3 frame", "song.mp3", []byte{0xff, 0xfb, 0x90, 0, 0, 0, 0, 0}, "audio", "audio/mpeg", "mp3"},
		{"mp3 frame under another name", "song.bin", []byte{0xff, 0xfb, 0x90, 0, 0, 0, 0, 0}, "document", mimeOctet, "bin"},
		{"aac", "x.aac", []byte{0xff, 0xf1, 0x50, 0x80, 0, 0, 0, 0}, "audio", "audio/aac", "aac"},
		{"m4a", "x.m4a", fakeFtyp("M4A "), "audio", "audio/mp4", "m4a"},
		{"m4a in an isom brand", "x.m4a", fakeFtyp("isom"), "audio", "audio/mp4", "m4a"},
		{"ogg opus", "x.opus", ogg("OpusHead"), "audio", "audio/ogg", "opus"},
		{"ogg vorbis", "x.ogg", ogg("\x01vorbis"), "audio", "audio/ogg", "ogg"},
		{"ogg theora", "x.ogv", ogg("\x80theora"), "document", mimeOctet, "ogv"},
		{"wav", "x.wav", append([]byte("RIFF\x00\x00\x00\x00WAVEfmt "), make([]byte, 20)...), "audio", "audio/wav", "wav"},
		{"mp4", "clip.bin", fakeFtyp("mp42"), "video", "video/mp4", "mp4"},
		{"mov goes as a document", "clip.mov", fakeFtyp("qt  "), "document", "video/quicktime", "mov"},
		{"heic", "a.heic", fakeFtyp("heic"), "document", mimeOctet, "heic"},
		{"exe", "Setup.exe", fakePE(), "document", "application/vnd.microsoft.portable-executable", "exe"},
		{"exe named pdf", "a.pdf", fakePE(), "", "", ""},
		{"MZ that is not a program", "a.exe", []byte("MZ\x90\x00\x03"), "", "", ""},
		{"MZ without PE under another name", "a.bin", []byte("MZ\x90\x00\x03"), "document", mimeOctet, "bin"},
		{"a dll is not a .exe", "lib.dll", fakePE(), "document", mimeOctet, "dll"},
		{"msi", "app.msi", ole, "document", "application/x-msi", "msi"},
		{"old office file", "old.doc", ole, "document", mimeOctet, "doc"},
		{"old office file named docx", "a.docx", ole, "", "", ""},
		{"pkg", "app.pkg", append([]byte("xar!"), make([]byte, 40)...), "document", "application/octet-stream", "pkg"},
		{"7z", "a.7z", []byte{0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 4}, "document", "application/x-7z-compressed", "7z"},
		{"rar", "a.rar", []byte("Rar!\x1a\x07\x00 more"), "document", "application/vnd.rar", "rar"},
		{"zip", "build.zip", makeZip(t, "src/a.txt", "build/app.exe"), "document", "application/zip", "zip"},
		{"zip named exe", "x.exe", makeZip(t, "a.txt"), "document", "application/zip", "zip"},
		{"zipped app", "My.app.zip", makeZip(t, "My.app/Contents/Info.plist"), "document", "application/zip", "zip"},
		{"apk", "app.apk", makeZip(t, "AndroidManifest.xml", "classes.dex"), "document", "application/vnd.android.package-archive", "apk"},
		{"apk name without a manifest", "app.apk", makeZip(t, "a.txt"), "document", "application/zip", "zip"},
		{"ipa", "app.ipa", makeZip(t, "Payload/My.app/Info.plist"), "document", "application/octet-stream", "ipa"},
		{"jar", "app.jar", makeZip(t, "META-INF/MANIFEST.MF", "A.class"), "document", "application/java-archive", "jar"},
		{"office-looking zip without content types", "a.docx", makeZip(t, "word/document.xml", "word/styles.xml"), "document", "application/zip", "zip"},
		{"gz", "a.log.gz", []byte{0x1f, 0x8b, 8, 0, 0, 0, 0, 0}, "document", "application/gzip", "gz"},
		{"tar.gz", "a.tar.gz", gz(t, makeTar(t, "a")), "document", "application/gzip", "tar.gz"},
		{"tgz", "a.tgz", gz(t, makeTar(t, "a")), "document", "application/gzip", "tgz"},
		{"xz", "a.tar.xz", []byte{0xfd, 0x37, 0x7a, 0x58, 0x5a, 0, 0, 4}, "document", "application/x-xz", "tar.xz"},
		{"bz2", "a.tar.bz2", []byte("BZh91AY&SY"), "document", "application/x-bzip2", "tar.bz2"},
		{"tar", "a.tar", makeTar(t, "src/a.txt"), "document", "application/x-tar", "tar"},
		{"docm with macros", "a.docx", makeZip(t, "[Content_Types].xml", "word/document.xml", "word/vbaProject.bin"), "", "", ""},
		{"docx with an exe", "a.docx", makeZip(t, "[Content_Types].xml", "word/document.xml", "payload.exe"), "", "", ""},
		{"docx with traversal", "a.docx", makeZip(t, "[Content_Types].xml", "word/document.xml", "../evil"), "", "", ""},
		{"docx with an embedded OLE object", "a.docx", makeZip(t, "[Content_Types].xml", "word/document.xml", "word/embeddings/oleObject1.bin"), "", "", ""},
		{"xlsx with an embedded package", "a.xlsx", makeZip(t, "[Content_Types].xml", "xl/workbook.xml", "xl/embeddings/Microsoft_Word_Document.docx"), "", "", ""},
		{"docx with activeX", "a.docx", makeZip(t, "[Content_Types].xml", "word/document.xml", "word/activeX/activeX1.xml"), "", "", ""},
		{"docx with a binary part", "a.docx", makeZip(t, "[Content_Types].xml", "word/document.xml", "word/media/x.bin"), "", "", ""},
		{"zip with .ssh", "a.zip", makeZip(t, "proj/.ssh/id_rsa"), "", "", ""},
		{"zip with .ssh under an unclaimed name", "a.bin", makeZip(t, "proj/.ssh/id_rsa"), "", "", ""},
		{"zip with a hidden folder", "a.zip", makeZip(t, ".codex/auth.json"), "", "", ""},
		{"zip with a database", "a.zip", makeZip(t, "Library/Messages/chat.db"), "", "", ""},
		{"tar with entries hidden behind the end marker", "a.tar", append(makeTar(t, "ok.txt"), makeTar(t, "home/.ssh/id_rsa")...), "", "", ""},
		{"zip with a traversal entry", "a.zip", makeZip(t, "a.txt", "../evil"), "", "", ""},
		{"tar with .env", "a.tar", makeTar(t, "app/.env"), "", "", ""},
		{"tar that is no tar", "a.tar", []byte(strings.Repeat("x", 600)), "", "", ""},
		{"elf named png", "a.png", []byte("\x7fELF\x02\x01"), "", "", ""},
		{"mach-o named pdf", "a.pdf", []byte("\xcf\xfa\xed\xfe\x07"), "", "", ""},
		{"elf binary", "tool", []byte("\x7fELF\x02\x01"), "document", mimeOctet, "bin"},
		{"mach-o binary", "tool.dylib", []byte("\xcf\xfa\xed\xfe\x07"), "document", mimeOctet, "dylib"},
		{"firmware", "firmware.bin", []byte{1, 2, 3, 4, 5, 6, 7, 8}, "document", mimeOctet, "bin"},
		{"no extension", "README", []byte("hello\n"), "document", mimeOctet, "bin"},
		{"an odd extension becomes bin", "weird.na$me!", []byte("x"), "document", mimeOctet, "bin"},
		{"json", "a.json", []byte(`{"a":1}`), "document", mimeOctet, "json"},
		{"script named txt", "a.txt", []byte("#!/bin/sh\nrm -rf /\n"), "", "", ""},
		{"html named txt", "a.txt", []byte("  <html><script>"), "", "", ""},
		{"plain text named html", "a.html", []byte("hello"), "", "", ""},
		{"text named py", "a.py", []byte("print(1)\n"), "document", mimeOctet, "py"},
		{"text named sh", "a.sh", []byte("#!/bin/sh\necho hi\n"), "document", mimeOctet, "sh"},
		{"text with NUL", "a.txt", []byte("a\x00b"), "", "", ""},
		{"invalid utf8", "a.txt", []byte{0xff, 0xfe, 0xfd}, "", "", ""},
		{"gif", "a.gif", []byte("GIF89a...."), "document", mimeOctet, "gif"},
		{"empty zip", "a.zip", []byte{0x50, 0x4b, 5, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0}, "", "", ""},
		{"empty", "a.txt", nil, "", "", ""},
	}
	for _, c := range cases {
		got, ok := sniffBytes(c.data, c.file)
		if ok != (c.mime != "") || (ok && (got.Kind != c.kind || got.Mime != c.mime || got.Ext != c.ext)) {
			t.Fatalf("%s: got ok=%v kind=%q mime=%q ext=%q", c.name, ok, got.Kind, got.Mime, got.Ext)
		}
	}
}

// fakeSizedReader claims a size but holds only a head (and a tail): the size rules without huge files.
type fakeSizedReader struct {
	head, tail []byte
}

func (f fakeSizedReader) ReadAt(p []byte, off int64) (int, error) {
	for i := range p {
		p[i] = 0
	}
	if off < int64(len(f.head)) {
		copy(p, f.head[off:])
	}
	return len(p), nil
}

func TestSniffSizeRules(t *testing.T) {
	kindOf := func(head []byte, size int64, name string) (string, bool) {
		got, ok := sniffAttachment(fakeSizedReader{head: head}, size, name)
		return got.Kind, ok
	}
	png := []byte("\x89PNG\r\n\x1a\nrest")
	for _, c := range []struct {
		name string
		head []byte
		size int64
		file string
		want string
	}{
		{"png at the photo limit", png, imageMaxBytes, "a.png", "image"},
		{"png over it", png, imageMaxBytes + 1, "a.png", "document"},
		{"mp4 at the video limit", fakeFtyp("isom"), videoMaxBytes, "a.mp4", "video"},
		{"mp4 over it", fakeFtyp("isom"), videoMaxBytes + 1, "a.mp4", "document"},
		{"mp4 of 90 MB", fakeFtyp("isom"), 90 << 20, "a.mp4", "document"},
		{"mp3 at the audio limit", []byte("ID3\x04\x00\x00\x00\x00\x00\x00"), audioMaxBytes, "a.mp3", "audio"},
		{"mp3 over it", []byte("ID3\x04\x00\x00\x00\x00\x00\x00"), audioMaxBytes + 1, "a.mp3", "document"},
		{"a 99 MB build", fakePE(), 99 << 20, "a.exe", "document"},
		{"the biggest document", fakePE(), fileMaxBytes, "a.exe", "document"},
	} {
		if got, ok := kindOf(c.head, c.size, c.file); !ok || got != c.want {
			t.Fatalf("%s: got %q ok=%v", c.name, got, ok)
		}
	}
	if _, ok := kindOf(fakePE(), fileMaxBytes+1, "a.exe"); ok {
		t.Fatal("a file over the document limit was accepted")
	}
}

func TestDisplayNameIsSafe(t *testing.T) {
	cases := map[string]string{
		"../../etc/passwd":        "passwd.pdf",
		"C:\\Users\\x\\avis.png":  "avis.pdf",
		"report\u202egpj.exe":     "reportgpj.pdf",
		"a\u200bb\x00c.txt":       "abc.pdf",
		"  .hidden  ":             "file.pdf",
		"":                        "file.pdf",
		"na:me*with?bad\"chars<>": "na_me_with_bad_chars__.pdf",
	}
	for in, want := range cases {
		if got := displayName(in, "pdf"); got != want {
			t.Fatalf("%q -> %q, want %q", in, got, want)
		}
	}
	for in, want := range map[string]string{"build-1.4.2.tar.gz": "build-1.4.2.tar.gz", "Setup.EXE": "Setup.exe", "notes.tar": "notes.zip"} {
		ext := "tar.gz"
		if strings.HasSuffix(want, ".exe") {
			ext = "exe"
		} else if strings.HasSuffix(want, ".zip") {
			ext = "zip"
		}
		if got := displayName(in, ext); got != want {
			t.Fatalf("%q -> %q, want %q", in, got, want)
		}
	}
	if got := displayName(strings.Repeat("a", 300)+".pdf", "pdf"); len([]rune(got)) != 84 {
		t.Fatalf("name not capped: %d", len([]rune(got)))
	}
}
