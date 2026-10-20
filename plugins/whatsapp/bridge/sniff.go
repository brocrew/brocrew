package main

import (
	"bytes"
	"io"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

// A photo, audio or video above these goes as a document; a document up to fileMaxBytes.
const (
	imageMaxBytes = 16 << 20
	audioMaxBytes = 64 << 20
	videoMaxBytes = 64 << 20
	fileMaxBytes  = 100 << 20
)

type attachType struct {
	Kind, Mime, Ext string
	ScanTarGz       bool
}

const (
	mimeDOCX  = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	mimeXLSX  = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	mimeOctet = "application/octet-stream"
	textCheck = 1 << 20
)

var badZipEntry = regexp.MustCompile(`(?i)\.(?:exe|dll|bat|cmd|com|scr|msi|js|jse|vbs|vbe|wsf|ps1|sh|jar|class|so|dylib)$`)

// readAt returns up to n bytes at offset (fewer at the end of the file).
func readAt(r io.ReaderAt, size, offset int64, n int) []byte {
	if offset < 0 || offset >= size {
		return nil
	}
	if remaining := size - offset; int64(n) > remaining {
		n = int(remaining)
	}
	buf := make([]byte, n)
	got, _ := r.ReadAt(buf, offset)
	return buf[:got]
}

func nameParts(fileName string) (lower, ext string) {
	if i := strings.LastIndexAny(fileName, "/\\"); i >= 0 {
		fileName = fileName[i+1:]
	}
	lower = strings.ToLower(fileName)
	if dot := strings.LastIndex(lower, "."); dot >= 0 {
		ext = lower[dot+1:]
	}
	return lower, ext
}

// withSizeRule: a photo, audio or video too big to be shown goes as a document; a .mov always does.
func withSizeRule(t attachType, size int64) attachType {
	limit := int64(0)
	switch t.Kind {
	case "image":
		limit = imageMaxBytes
	case "audio":
		limit = audioMaxBytes
	case "video":
		limit = videoMaxBytes
	default:
		return t
	}
	if size > limit || t.Mime == "video/quicktime" {
		t.Kind = "document"
	}
	return t
}

func office(names []string) (attachType, bool, bool) { // type, isOffice, allowed
	has := map[string]bool{}
	for _, n := range names {
		has[n] = true
	}
	if !has["[Content_Types].xml"] {
		return attachType{}, false, true
	}
	var t attachType
	switch {
	case has["word/document.xml"]:
		t = attachType{Kind: "document", Mime: mimeDOCX, Ext: "docx"}
	case has["xl/workbook.xml"]:
		t = attachType{Kind: "document", Mime: mimeXLSX, Ext: "xlsx"}
	default:
		return attachType{}, false, true
	}
	for _, n := range names {
		lower := strings.ToLower(n)
		if strings.HasPrefix(n, "/") || strings.Contains(n, "..") || strings.Contains(n, "\\") || badZipEntry.MatchString(n) || strings.HasSuffix(lower, "vbaproject.bin") ||
			strings.Contains(lower, "/embeddings/") || strings.HasPrefix(lower, "embeddings/") || strings.Contains(lower, "/activex/") || strings.HasPrefix(lower, "activex/") ||
			strings.Contains(lower[strings.LastIndex(lower, "/")+1:], "oleobject") || strings.HasSuffix(lower, ".bin") {
			return attachType{}, true, false // macros, embedded objects, executables or traversal inside a document
		}
	}
	return t, true, true
}

func sniffZip(r io.ReaderAt, size int64, ext string) (attachType, sniffResult) {
	names, err := zipNames(r, size)
	if err != nil {
		return attachType{}, sniffRefused
	}
	if t, isOffice, allowed := office(names); isOffice {
		if !allowed {
			return attachType{}, sniffRefused
		}
		return t, sniffOK
	}
	if anyEntryDenied(names) {
		return attachType{}, sniffRefused
	}
	has := func(n string) bool {
		for _, x := range names {
			if x == n {
				return true
			}
		}
		return false
	}
	switch {
	case ext == "apk" && has("AndroidManifest.xml"):
		return attachType{Kind: "document", Mime: "application/vnd.android.package-archive", Ext: "apk"}, sniffOK
	case ext == "ipa":
		for _, n := range names {
			if strings.HasPrefix(n, "Payload/") {
				return attachType{Kind: "document", Mime: mimeOctet, Ext: "ipa"}, sniffOK
			}
		}
	case ext == "aab" && has("BundleConfig.pb"):
		return attachType{Kind: "document", Mime: mimeOctet, Ext: "aab"}, sniffOK
	case ext == "jar" && has("META-INF/MANIFEST.MF"):
		return attachType{Kind: "document", Mime: "application/java-archive", Ext: "jar"}, sniffOK
	}
	return attachType{Kind: "document", Mime: "application/zip", Ext: "zip"}, sniffOK
}

func sniffText(r io.ReaderAt, size int64, ext string) (attachType, sniffResult) {
	if ext == "htm" {
		ext = "html"
	}
	if ext != "txt" && ext != "csv" && ext != "html" && ext != "svg" {
		return attachType{}, sniffUnknown
	}
	head := readAt(r, size, 0, textCheck)
	if int64(len(head)) < size { // cut inside a multi-byte character is not an error
		for i := 0; i < 3 && len(head) > 0 && !utf8.Valid(head); i++ {
			head = head[:len(head)-1]
		}
	}
	if !utf8.Valid(head) {
		return attachType{}, sniffUnknown
	}
	text := strings.TrimPrefix(string(head), "\xef\xbb\xbf")
	for _, c := range text {
		if c == 0 || (c < 0x20 && c != '\t' && c != '\n' && c != '\r') || c == 0x7f {
			return attachType{}, sniffUnknown
		}
	}
	start := strings.ToLower(strings.TrimLeftFunc(text, unicode.IsSpace))
	if len(start) > 64 {
		start = start[:64]
	}
	if ext == "html" || ext == "svg" {
		if !strings.HasPrefix(start, "<") {
			return attachType{}, sniffUnknown
		}
		if ext == "svg" {
			return attachType{Kind: "document", Mime: "image/svg+xml", Ext: "svg"}, sniffOK
		}
		return attachType{Kind: "document", Mime: "text/html", Ext: "html"}, sniffOK
	}
	if strings.HasPrefix(start, "#!") || strings.HasPrefix(start, "<") || strings.HasPrefix(start, "%!ps") {
		return attachType{}, sniffUnknown
	}
	if ext == "csv" {
		return attachType{Kind: "document", Mime: "text/csv", Ext: "csv"}, sniffOK
	}
	return attachType{Kind: "document", Mime: "text/plain", Ext: "txt"}, sniffOK
}

func isPE(r io.ReaderAt, size int64) bool {
	head := readAt(r, size, 0, 64)
	if len(head) < 64 || string(head[:2]) != "MZ" {
		return false
	}
	at := int64(head[0x3c]) | int64(head[0x3d])<<8 | int64(head[0x3e])<<16 | int64(head[0x3f])<<24
	return at > 0 && at+4 <= size && string(readAt(r, size, at, 4)) == "PE\x00\x00"
}

func tarHeaderOK(block []byte) bool {
	if len(block) < 512 {
		return false
	}
	sum := 0
	for i, b := range block[:512] {
		if i >= 148 && i < 156 {
			sum += 32
		} else {
			sum += int(b)
		}
	}
	field := strings.TrimSpace(strings.TrimRight(string(block[148:156]), "\x00 "))
	if field == "" {
		return false
	}
	want := 0
	for _, c := range field {
		if c < '0' || c > '7' {
			return false
		}
		want = want*8 + int(c-'0')
	}
	return want == sum
}

// sniffKnown decides the type from the bytes: sniffOK with the type, sniffUnknown when the bytes match none of the known types,
// sniffRefused for what is unsafe (an empty or too big file, an archive with credential-looking entries, a document with macros
// or embedded objects). fileName only separates look-alikes (txt/csv, mp3/aac...) and names compound archive types.
func sniffKnown(r io.ReaderAt, size int64, fileName string) (attachType, sniffResult) {
	lower, ext := nameParts(fileName)
	if size <= 0 || size > fileMaxBytes {
		return attachType{}, sniffRefused
	}
	head := readAt(r, size, 0, 4096)
	ascii := func(from, to int) string {
		if to > len(head) {
			to = len(head)
		}
		if from >= to {
			return ""
		}
		return string(head[from:to])
	}
	sized := func(t attachType) (attachType, sniffResult) { return withSizeRule(t, size), sniffOK }
	switch {
	case bytes.HasPrefix(head, []byte{0xff, 0xd8, 0xff}):
		return sized(attachType{Kind: "image", Mime: "image/jpeg", Ext: "jpg"})
	case bytes.HasPrefix(head, []byte("\x89PNG\r\n\x1a\n")):
		return sized(attachType{Kind: "image", Mime: "image/png", Ext: "png"})
	case ascii(0, 4) == "RIFF" && ascii(8, 12) == "WEBP":
		return sized(attachType{Kind: "image", Mime: "image/webp", Ext: "webp"})
	case ascii(0, 4) == "RIFF" && ascii(8, 12) == "WAVE":
		return sized(attachType{Kind: "audio", Mime: "audio/wav", Ext: "wav"})
	case ascii(0, 5) == "%PDF-":
		return attachType{Kind: "document", Mime: "application/pdf", Ext: "pdf"}, sniffOK
	case ext == "dmg" && size >= 512 && string(readAt(r, size, size-512, 4)) == "koly":
		return attachType{Kind: "document", Mime: "application/x-apple-diskimage", Ext: "dmg"}, sniffOK
	case ascii(0, 3) == "ID3":
		return sized(attachType{Kind: "audio", Mime: "audio/mpeg", Ext: "mp3"})
	case ascii(0, 4) == "OggS":
		first := ascii(0, 200)
		switch {
		case strings.Contains(first, "OpusHead"):
			e := "ogg"
			if ext == "opus" {
				e = "opus"
			}
			return sized(attachType{Kind: "audio", Mime: "audio/ogg", Ext: e})
		case strings.Contains(first, "\x01vorbis"):
			return sized(attachType{Kind: "audio", Mime: "audio/ogg", Ext: "ogg"})
		}
		return attachType{}, sniffUnknown
	}
	if len(head) >= 4 && head[0] == 0xff && head[1]&0xe0 == 0xe0 {
		version, layer := (head[1]>>3)&3, (head[1]>>1)&3
		if version != 1 && head[2]>>4 != 15 && (head[2]>>2)&3 != 3 {
			if layer == 0 && ext == "aac" {
				return sized(attachType{Kind: "audio", Mime: "audio/aac", Ext: "aac"})
			}
			if layer != 0 && ext == "mp3" {
				return sized(attachType{Kind: "audio", Mime: "audio/mpeg", Ext: "mp3"})
			}
		}
	}
	if ascii(4, 8) == "ftyp" {
		brand := ascii(8, 12)
		isAny := func(list ...string) bool {
			for _, b := range list {
				if brand == b {
					return true
				}
			}
			return false
		}
		switch {
		case isAny("M4A ", "M4B ", "M4P ") || (ext == "m4a" && isAny("isom", "mp42", "mp41", "iso2")):
			return sized(attachType{Kind: "audio", Mime: "audio/mp4", Ext: "m4a"})
		case brand == "qt  ":
			return sized(attachType{Kind: "video", Mime: "video/quicktime", Ext: "mov"})
		case isAny("isom", "iso2", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "M4V ", "dash", "mmp4"):
			return sized(attachType{Kind: "video", Mime: "video/mp4", Ext: "mp4"})
		}
	}
	switch {
	case ascii(0, 2) == "MZ":
		if ext != "exe" || !isPE(r, size) {
			return attachType{}, sniffUnknown
		}
		return attachType{Kind: "document", Mime: "application/vnd.microsoft.portable-executable", Ext: "exe"}, sniffOK
	case bytes.HasPrefix(head, []byte{0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1}):
		if ext != "msi" {
			return attachType{}, sniffUnknown
		}
		return attachType{Kind: "document", Mime: "application/x-msi", Ext: "msi"}, sniffOK
	case ascii(0, 4) == "xar!":
		if ext != "pkg" {
			return attachType{}, sniffUnknown
		}
		return attachType{Kind: "document", Mime: mimeOctet, Ext: "pkg"}, sniffOK
	case bytes.HasPrefix(head, []byte{0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c}):
		return attachType{Kind: "document", Mime: "application/x-7z-compressed", Ext: "7z"}, sniffOK
	case ascii(0, 6) == "Rar!\x1a\x07":
		return attachType{Kind: "document", Mime: "application/vnd.rar", Ext: "rar"}, sniffOK
	case bytes.HasPrefix(head, []byte("PK\x03\x04")) || bytes.HasPrefix(head, []byte("PK\x05\x06")):
		return sniffZip(r, size, ext)
	case bytes.HasPrefix(head, []byte{0x1f, 0x8b, 0x08}):
		if strings.HasSuffix(lower, ".tar.gz") {
			return attachType{Kind: "document", Mime: "application/gzip", Ext: "tar.gz", ScanTarGz: true}, sniffOK
		}
		if ext == "tgz" {
			return attachType{Kind: "document", Mime: "application/gzip", Ext: "tgz", ScanTarGz: true}, sniffOK
		}
		return attachType{Kind: "document", Mime: "application/gzip", Ext: "gz"}, sniffOK
	case bytes.HasPrefix(head, []byte{0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00}):
		e := "xz"
		if strings.HasSuffix(lower, ".tar.xz") {
			e = "tar.xz"
		} else if ext == "txz" {
			e = "txz"
		}
		return attachType{Kind: "document", Mime: "application/x-xz", Ext: e}, sniffOK
	case ascii(0, 3) == "BZh" && len(head) > 3 && head[3] >= '1' && head[3] <= '9':
		e := "bz2"
		if strings.HasSuffix(lower, ".tar.bz2") {
			e = "tar.bz2"
		} else if ext == "tbz2" {
			e = "tbz2"
		}
		return attachType{Kind: "document", Mime: "application/x-bzip2", Ext: e}, sniffOK
	case len(head) >= 512 && (ascii(257, 262) == "ustar" || ext == "tar"):
		if !tarHeaderOK(head[:512]) {
			return attachType{}, sniffUnknown
		}
		names, err := tarNames(io.NewSectionReader(r, 0, size))
		if err != nil || anyEntryDenied(names) {
			return attachType{}, sniffRefused
		}
		return attachType{Kind: "document", Mime: "application/x-tar", Ext: "tar"}, sniffOK
	}
	return sniffText(r, size, ext)
}

type sniffResult int

const (
	sniffOK sniffResult = iota
	sniffUnknown
	sniffRefused
)

// claimedExtensions are the extensions whose names promise one of the types above: bytes that do not match are refused instead of
// being sent under that name.
var claimedExtensions = map[string]bool{}

func init() {
	for _, e := range strings.Fields("jpg jpeg png webp pdf docx xlsx txt csv html htm svg mp3 aac m4a ogg opus wav mp4 mov exe msi dmg pkg apk ipa aab jar zip 7z rar tar gz tgz xz txz bz2 tbz2") {
		claimedExtensions[e] = true
	}
}

var genericExt = regexp.MustCompile(`^[a-z0-9]{1,10}$`)

// sniffAttachment is the type of these bytes. Unknown bytes under a name that does not claim a known type are an
// application/octet-stream document with the file's own extension; a name that claims a type its bytes are not, and everything
// unsafe, are refused (false).
func sniffAttachment(r io.ReaderAt, size int64, fileName string) (attachType, bool) {
	t, result := sniffKnown(r, size, fileName)
	switch result {
	case sniffOK:
		return t, true
	case sniffUnknown:
		_, ext := nameParts(fileName)
		if claimedExtensions[ext] {
			return attachType{}, false
		}
		if !genericExt.MatchString(ext) {
			ext = "bin"
		}
		return attachType{Kind: "document", Mime: mimeOctet, Ext: ext}, true
	}
	return attachType{}, false
}

// displayName: base name only, no control or bidi characters, no reserved characters, capped, with the TRUE extension (which
// may have two parts, like tar.gz).
func displayName(name, ext string) string {
	if i := strings.LastIndexAny(name, "/\\"); i >= 0 {
		name = name[i+1:]
	}
	if strings.HasSuffix(strings.ToLower(name), "."+ext) {
		name = name[:len(name)-len(ext)-1]
	} else if dot := strings.LastIndex(name, "."); dot > 0 {
		name = name[:dot]
	}
	var b strings.Builder
	for _, r := range name {
		switch {
		case unicode.IsControl(r), r >= 0x200b && r <= 0x200f, r >= 0x202a && r <= 0x202e, r >= 0x2060 && r <= 0x2064, r >= 0x2066 && r <= 0x206f, r == 0xfeff, r == 0xad, r == 0x61c, r == 0x180e:
		case strings.ContainsRune(`:*?"<>|`, r):
			b.WriteRune('_')
		case unicode.IsSpace(r):
			b.WriteRune(' ')
		default:
			b.WriteRune(r)
		}
	}
	stem := strings.TrimLeft(strings.TrimSpace(strings.Join(strings.Fields(b.String()), " ")), ". ")
	if r := []rune(stem); len(r) > 80 {
		stem = string(r[:80])
	}
	if stem == "" {
		stem = "file"
	}
	return stem + "." + ext
}

// loadOutboxAttachment opens and verifies the outbox file named by the request; the second result is a fixed error code. On
// success the file stays open (the caller closes it); nothing of it is read into memory.
