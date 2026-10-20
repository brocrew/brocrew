package main

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"encoding/binary"
	"errors"
	"io"
	"regexp"
	"strings"
	"unicode/utf8"
)

// Looks INSIDE archives sent to a group, without extracting anything: only the entry names are read (zip: the central
// directory; tar: the headers; tar.gz: streamed through gunzip with a byte budget). An archive that contains a name that looks
// like a credential store is refused. Best effort:
// 7z, rar, dmg, tar.xz and tar.bz2 are opaque to it.

const (
	maxArchiveEntries = 200_000
	maxScanBytes      = 16 << 30
)

var errArchive = errors.New("not a valid archive")

var deniedDirs = map[string]bool{"keychains": true}

// A few harmless dotfiles that build and source archives are full of; every other hidden file or folder is refused, like the path guard does.
var dotfilesOK = map[string]bool{".ds_store": true, ".gitignore": true, ".gitattributes": true, ".gitkeep": true, ".gitmodules": true, ".editorconfig": true, ".npmignore": true, ".dockerignore": true, ".nvmrc": true, ".prettierrc": true}

var libraryPrivate = map[string]bool{"keychains": true, "messages": true, "mail": true, "safari": true, "cookies": true, "application support": true, "preferences": true, "accounts": true, "containers": true, "group containers": true}

var deniedName = regexp.MustCompile(`^(?:_netrc|kubeconfig|authorized_keys|(?:.*[-_.])?auth\.json|.*credentials.*\.json|credentials?(?:[-_.].*)?|client[-_]?secrets?(?:[-_.].*)?|service[-_]?account.*|secrets?(?:\..*)?|passwords?(?:\..*)?|passwd|shadow|tokens?(?:\..*)?|.*[-_.]tokens?\.json|cookies?(?:\..*)?|login data|.*_history|.*\.(?:db|sqlite|sqlite3)|.*\.(?:pem|key|p12|pfx|jks|keystore|kdbx|keychain|keychain-db|ovpn|tfstate|tfvars|p8|mobileprovision|wallet|jwk))$`)

var driveLetter = regexp.MustCompile(`^[a-z]:[\\/]`)

// foldName lower-cases and maps full-width ASCII letters to plain ones (the cases NFKC matters for in practice).
func foldName(name string) string {
	var b strings.Builder
	for _, r := range name {
		if r >= 0xff01 && r <= 0xff5e {
			r = r - 0xff01 + 0x21
		}
		b.WriteRune(r)
	}
	return strings.ToLower(b.String())
}

// Project archives carry these two hidden folders; they are let through, but anything below them is held to a stricter name rule.
var allowedDotDirs = map[string]bool{".github": true, ".vscode": true}

var strictUnderAllowed = regexp.MustCompile(`token|secret|credential|passw|cookie|^\.env|\.pem$|\.key$|^id_|auth\.json|\.(?:p12|pfx|jks|keystore|kdbx|ovpn|p8)$`)

// resolveSegments is path resolved on top of base: "." and empty parts dropped, ".." pops; false when it climbs out of the root.
func resolveSegments(path string, base []string) ([]string, bool) {
	segments := append([]string(nil), base...)
	for _, s := range strings.FieldsFunc(path, func(r rune) bool { return r == '/' || r == '\\' }) {
		switch s {
		case ".":
		case "..":
			if len(segments) == 0 {
				return nil, false
			}
			segments = segments[:len(segments)-1]
		default:
			segments = append(segments, s)
		}
	}
	return segments, true
}

// linkTargetDenied says why the target of a tar link is refused, or returns "". A symbolic link is resolved from the folder of the
// entry, a hard link from the archive root; an absolute target, one that climbs out of the archive, or one that lands on a refused
// name is refused.
func linkTargetDenied(entry, target string, symbolic bool) string {
	wanted := foldName(target)
	if strings.HasPrefix(wanted, "/") || driveLetter.MatchString(wanted) {
		return "an absolute path"
	}
	var base []string
	if symbolic {
		own, ok := resolveSegments(foldName(entry), nil)
		if !ok {
			return "a path that climbs out of the archive"
		}
		if len(own) > 0 {
			base = own[:len(own)-1]
		}
	}
	resolved, ok := resolveSegments(wanted, base)
	if !ok {
		return "a path that climbs out of the archive"
	}
	if len(resolved) == 0 {
		return ""
	}
	return archiveEntryDenied(strings.Join(resolved, "/"))
}

// archiveEntryDenied says why an archive entry name is refused, or returns "". The path is normalised first (`.` and `..`
// resolved, `//` collapsed; an absolute path or a `..` that climbs out is refused), then every segment is checked.
func archiveEntryDenied(entry string) string {
	name := foldName(entry)
	if strings.HasPrefix(name, "/") || driveLetter.MatchString(name) {
		return "an absolute path"
	}
	var segments []string
	for _, s := range strings.FieldsFunc(name, func(r rune) bool { return r == '/' || r == '\\' }) {
		switch s {
		case ".":
		case "..":
			if len(segments) == 0 {
				return "a path that climbs out of the archive"
			}
			segments = segments[:len(segments)-1]
		default:
			segments = append(segments, s)
		}
	}
	endsAsDirectory := strings.HasSuffix(name, "/") || strings.HasSuffix(name, "\\")
	for i, s := range segments {
		if s == "library" && (i == 0 || (i+1 < len(segments) && libraryPrivate[segments[i+1]])) {
			return "a macOS Library folder"
		}
	}
	underAllowedFolder := false
	for i, s := range segments {
		isDirectory := i < len(segments)-1 || endsAsDirectory
		if underAllowedFolder && strictUnderAllowed.MatchString(s) {
			return "a name that looks like a credential, key or secret"
		}
		if strings.HasPrefix(s, ".") {
			if isDirectory && allowedDotDirs[s] {
				underAllowedFolder = true
				continue
			}
			if isDirectory || (!dotfilesOK[s] && !strings.HasPrefix(s, "._")) {
				return "a hidden file or folder (dotfile)"
			}
		}
		if s == "hosts.yml" && i > 0 && segments[i-1] == "gh" {
			return "a name that looks like a credential, key or secret"
		}
		if s == "thumbs.db" {
			continue
		}
		if deniedDirs[s] || strings.HasSuffix(s, "-auth") || deniedName.MatchString(s) || (strings.HasPrefix(s, "id_") && isPrivateKeyName(s)) {
			return "a name that looks like a credential, key or secret"
		}
	}
	return ""
}

func isPrivateKeyName(s string) bool {
	for _, kind := range []string{"rsa", "dsa", "ecdsa", "ed25519"} {
		if strings.HasPrefix(s, "id_"+kind) && !strings.HasSuffix(s, ".pub") {
			return true
		}
	}
	return false
}

// firstDeniedEntry returns true when any name is refused.
func anyEntryDenied(names []string) bool {
	for _, n := range names {
		if archiveEntryDenied(n) != "" {
			return true
		}
	}
	return false
}

// zipNames lists the entry names of a zip (zip64 included) from its central directory only.
func zipNames(r io.ReaderAt, size int64) ([]string, error) {
	reader, err := zip.NewReader(r, size)
	if err != nil || len(reader.File) == 0 || len(reader.File) > maxArchiveEntries {
		return nil, errArchive
	}
	names := make([]string, 0, len(reader.File))
	for _, f := range reader.File {
		names = append(names, f.Name)
	}
	if err := zipLocalNamesMatch(r, size, len(names)); err != nil {
		return nil, err
	}
	return names, nil
}

var errZipNameMismatch = errors.New("zip entry named differently in its directory and its header")

// maxCentralDirectory is the most of a zip's central directory that is read.
const maxCentralDirectory = 64 << 20

// zipLocalNamesMatch walks the central directory itself (zip64 included) and requires that every entry has the same name in its local
// header: a streaming unzipper trusts the local one, so a directory that says "okay/xx.txt" over a header that says ".ssh/id_rsa" would
// slip past a check of the directory alone.
func zipLocalNamesMatch(r io.ReaderAt, size int64, expected int) error {
	tailLength := int64(22 + 65535)
	if tailLength > size {
		tailLength = size
	}
	tail := readAt(r, size, size-tailLength, int(tailLength))
	eocd := -1
	for i := len(tail) - 22; i >= 0; i-- {
		if binary.LittleEndian.Uint32(tail[i:]) == 0x06054b50 {
			eocd = i
			break
		}
	}
	if eocd < 0 {
		return errArchive
	}
	count := uint64(binary.LittleEndian.Uint16(tail[eocd+10:]))
	cdSize := uint64(binary.LittleEndian.Uint32(tail[eocd+12:]))
	cdOffset := uint64(binary.LittleEndian.Uint32(tail[eocd+16:]))
	if count == 0xffff || cdSize == 0xffffffff || cdOffset == 0xffffffff {
		locatorAt := size - tailLength + int64(eocd) - 20
		if locatorAt < 0 {
			return errArchive
		}
		locator := readAt(r, size, locatorAt, 20)
		if len(locator) < 20 || binary.LittleEndian.Uint32(locator) != 0x07064b50 {
			return errArchive
		}
		record := readAt(r, size, int64(binary.LittleEndian.Uint64(locator[8:])), 56)
		if len(record) < 56 || binary.LittleEndian.Uint32(record) != 0x06064b50 {
			return errArchive
		}
		count = binary.LittleEndian.Uint64(record[32:])
		cdSize = binary.LittleEndian.Uint64(record[40:])
		cdOffset = binary.LittleEndian.Uint64(record[48:])
	}
	if count == 0 || count > maxArchiveEntries || cdSize > maxCentralDirectory || int64(cdOffset+cdSize) > size || int(count) != expected {
		return errArchive
	}
	directory := readAt(r, size, int64(cdOffset), int(cdSize))
	if uint64(len(directory)) != cdSize {
		return errArchive
	}
	at := 0
	for n := uint64(0); n < count; n++ {
		if at+46 > len(directory) || binary.LittleEndian.Uint32(directory[at:]) != 0x02014b50 {
			return errArchive
		}
		nameLength := int(binary.LittleEndian.Uint16(directory[at+28:]))
		extraLength := int(binary.LittleEndian.Uint16(directory[at+30:]))
		commentLength := int(binary.LittleEndian.Uint16(directory[at+32:]))
		if at+46+nameLength+extraLength > len(directory) {
			return errArchive
		}
		name := directory[at+46 : at+46+nameLength]
		localAt, ok := localHeaderOffset(directory, at, nameLength, extraLength)
		if !ok {
			return errArchive
		}
		local := readAt(r, size, localAt, 30)
		if len(local) < 30 || binary.LittleEndian.Uint32(local) != 0x04034b50 {
			return errArchive
		}
		localName := readAt(r, size, localAt+30, int(binary.LittleEndian.Uint16(local[26:])))
		if !bytes.Equal(localName, name) {
			return errZipNameMismatch
		}
		at += 46 + nameLength + extraLength + commentLength
	}
	return nil
}

// localHeaderOffset is where the local header of a central-directory entry is: its 32-bit offset, or the zip64 extra field when that is 0xFFFFFFFF.
func localHeaderOffset(directory []byte, at, nameLength, extraLength int) (int64, bool) {
	offset32 := binary.LittleEndian.Uint32(directory[at+42:])
	if offset32 != 0xffffffff {
		return int64(offset32), true
	}
	need := 0
	if binary.LittleEndian.Uint32(directory[at+24:]) == 0xffffffff {
		need += 8
	}
	if binary.LittleEndian.Uint32(directory[at+20:]) == 0xffffffff {
		need += 8
	}
	extra := at + 46 + nameLength
	end := extra + extraLength
	for extra+4 <= end {
		id := binary.LittleEndian.Uint16(directory[extra:])
		length := int(binary.LittleEndian.Uint16(directory[extra+2:]))
		if id == 1 && extra+4+need+8 <= end {
			return int64(binary.LittleEndian.Uint64(directory[extra+4+need:])), true
		}
		extra += 4 + length
	}
	return 0, false
}

type budgetReader struct {
	r    io.Reader
	left int64
}

var errScanBudget = errors.New("archive too large to check")

func (b *budgetReader) Read(p []byte) (int, error) {
	if b.left <= 0 {
		return 0, errScanBudget
	}
	if int64(len(p)) > b.left {
		p = p[:b.left]
	}
	n, err := b.r.Read(p)
	b.left -= int64(n)
	return n, err
}

// tarNames lists the entry names of a tar stream. A plain tar passed as a seeker is skipped through, not read.
func tarNames(r io.Reader) ([]string, error) {
	reader := tar.NewReader(r)
	var names []string
	for {
		header, err := reader.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, errArchive
		}
		if !utf8.ValidString(header.Name) {
			return nil, errArchive
		}
		if header.Typeflag == tar.TypeSymlink || header.Typeflag == tar.TypeLink {
			if linkTargetDenied(header.Name, header.Linkname, header.Typeflag == tar.TypeSymlink) != "" {
				return nil, errArchive
			}
		}
		names = append(names, header.Name)
		if len(names) > maxArchiveEntries {
			return nil, errArchive
		}
	}
	if len(names) == 0 {
		return nil, errArchive
	}
	// Nothing but padding may follow the end marker: `tar -i` would extract entries hidden behind it.
	var rest zeroSink
	if _, err := io.Copy(&rest, r); err != nil || rest.dirty {
		return nil, errArchive
	}
	return names, nil
}

type zeroSink struct{ dirty bool }

func (z *zeroSink) Write(p []byte) (int, error) {
	for _, b := range p {
		if b != 0 {
			z.dirty = true
		}
	}
	return len(p), nil
}

// tarGzNames streams a tar.gz through gunzip; nothing but the names is kept.
func tarGzNames(r io.Reader) ([]string, error) {
	gz, err := gzip.NewReader(r)
	if err != nil {
		return nil, errArchive
	}
	defer gz.Close()
	return tarNames(&budgetReader{r: gz, left: maxScanBytes})
}
