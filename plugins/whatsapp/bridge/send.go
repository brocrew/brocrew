package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
	"unicode/utf8"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"google.golang.org/protobuf/proto"
)

const (
	groupSendTextRunes     = 4100 // 4000 characters of text plus the "🤖 " marker
	attachmentCaptionRunes = 1002
	groupSendHourlyLimit   = 40
	groupSendMinInterval   = 2 * time.Second
	groupSendTimeout       = 20 * time.Second
	attachmentSendTimeout  = 100 * time.Second // inside the app's two-minute limit on one tool call
)

var errGroupUnavailable = errors.New("group sending unavailable")

type groupLimiter struct {
	mu       sync.Mutex
	attempts []time.Time
	interval time.Duration
}

func (l *groupLimiter) reserve(now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	cutoff := now.Add(-time.Hour)
	active := l.attempts[:0]
	for _, t := range l.attempts {
		if t.After(cutoff) {
			active = append(active, t)
		}
	}
	l.attempts = active
	if len(active) >= groupSendHourlyLimit {
		return false
	}
	spacing := groupSendMinInterval
	if l.interval > 0 {
		spacing = l.interval
	}
	if len(active) > 0 && now.Sub(active[len(active)-1]) < spacing {
		return false
	}
	l.attempts = append(l.attempts, now)
	return true
}

type sendFile struct {
	Path   string `json:"path"`
	Name   string `json:"name"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}

type sendRequest struct {
	Group string    `json:"group"`
	Text  string    `json:"text"`
	File  *sendFile `json:"file,omitempty"`
}

type sendResult struct {
	Kind string `json:"kind,omitempty"`
	Name string `json:"name,omitempty"`
}

type attachment struct {
	File *os.File
	Size int64
	Mime string
	Kind string
	Name string
	SHA  []byte
	Ext  string
}

// groupFor resolves a JID the Node server named to one of the account's own groups. A person is never a group.
func (s *session) groupFor(ctx context.Context, raw string) (types.JID, bool) {
	jid, err := types.ParseJID(raw)
	if err != nil || jid.Server != types.GroupServer || jid.User == "" || jid.Device != 0 {
		return types.EmptyJID, false
	}
	groups, err := s.groupsFor(ctx, false)
	if err != nil {
		return types.EmptyJID, false
	}
	for _, group := range groups {
		if group.JID == jid.String() {
			return jid, true
		}
	}
	return types.EmptyJID, false
}

func validText(text string, limit int, needed bool) bool {
	return utf8.ValidString(text) && utf8.RuneCountInString(text) <= limit && !strings.ContainsRune(text, '\x00') &&
		(!needed || strings.TrimSpace(text) != "")
}

// within reports whether real is root itself or below it.
func within(root, real string) bool {
	rel, err := filepath.Rel(root, real)
	return err == nil && rel != "." && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel)
}

// openAttachment opens a file under the plugin's files folder without following links, then checks its size, its type from the
// bytes and the SHA-256 the Node server computed. The file stays open; the caller closes it.
func openAttachment(filesDir string, request sendFile) (attachment, string) {
	if request.Size <= 0 || request.Size > fileMaxBytes || len(request.SHA256) != 64 || len(request.Name) > 300 {
		return attachment{}, "invalid_request"
	}
	wantSHA, err := hex.DecodeString(request.SHA256)
	if err != nil {
		return attachment{}, "invalid_request"
	}
	root, err := filepath.EvalSymlinks(filesDir)
	if err != nil {
		return attachment{}, "not_found"
	}
	if !filepath.IsAbs(request.Path) || filepath.Clean(request.Path) != request.Path {
		return attachment{}, "outside"
	}
	real, err := filepath.EvalSymlinks(request.Path)
	if err != nil || real != request.Path || !within(root, real) {
		return attachment{}, "outside"
	}
	file, err := openNoFollow(real, os.O_RDONLY|syscall.O_NONBLOCK, 0)
	if err != nil {
		return attachment{}, "not_found"
	}
	refuse := func(code string) (attachment, string) {
		file.Close()
		return attachment{}, code
	}
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() != request.Size {
		return refuse("invalid_request")
	}
	if hardLinked(file, info) {
		return refuse("invalid_request")
	}
	typ, ok := sniffAttachment(file, request.Size, request.Name)
	if !ok {
		return refuse("unsupported_media_type")
	}
	hasher := sha256.New()
	if n, err := io.Copy(hasher, io.NewSectionReader(file, 0, request.Size)); err != nil || n != request.Size {
		return refuse("invalid_request")
	}
	if !bytes.Equal(hasher.Sum(nil), wantSHA) {
		return refuse("changed")
	}
	if typ.ScanTarGz {
		names, err := tarGzNames(io.NewSectionReader(file, 0, request.Size))
		if err != nil || anyEntryDenied(names) {
			return refuse("unsupported_media_type")
		}
	}
	return attachment{File: file, Size: request.Size, Mime: typ.Mime, Kind: typ.Kind, Name: displayName(request.Name, typ.Ext),
		SHA: wantSHA, Ext: typ.Ext}, ""
}

var errChangedFile = errors.New("the file changed while it was uploaded")

type mediaUploader interface {
	UploadReader(ctx context.Context, plaintext io.Reader, tempFile io.ReadWriteSeeker, appInfo whatsmeow.MediaType) (whatsmeow.UploadResponse, error)
}

func cleanScratch(dir string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), "upload-") {
			_ = os.Remove(filepath.Join(dir, e.Name()))
		}
	}
}

func mediaTypeFor(kind string) whatsmeow.MediaType {
	switch kind {
	case "image":
		return whatsmeow.MediaImage
	case "audio":
		return whatsmeow.MediaAudio
	case "video":
		return whatsmeow.MediaVideo
	}
	return whatsmeow.MediaDocument
}

// uploadAttachment encrypts the file into a scratch file as it is read, and uploads from there; the hash the upload computed
// must equal the one that was checked, so what is sent is what was checked.
func uploadAttachment(ctx context.Context, up mediaUploader, att attachment, dir string) (whatsmeow.UploadResponse, error) {
	scratch, err := os.CreateTemp(dir, "upload-*")
	if err != nil {
		return whatsmeow.UploadResponse{}, err
	}
	defer func() {
		scratch.Close()
		_ = os.Remove(scratch.Name())
	}()
	resp, err := up.UploadReader(ctx, io.NewSectionReader(att.File, 0, att.Size), scratch, mediaTypeFor(att.Kind))
	if err != nil {
		return whatsmeow.UploadResponse{}, err
	}
	if !bytes.Equal(resp.FileSHA256, att.SHA) || resp.FileLength != uint64(att.Size) {
		return whatsmeow.UploadResponse{}, errChangedFile
	}
	return resp, nil
}

// buildMediaMessages is the message for an uploaded file. An audio message has no caption, so its caption follows as text.
func buildMediaMessages(att attachment, caption string, resp whatsmeow.UploadResponse) []*waE2E.Message {
	switch att.Kind {
	case "image":
		return []*waE2E.Message{{ImageMessage: &waE2E.ImageMessage{
			Caption: proto.String(caption), Mimetype: proto.String(att.Mime), URL: &resp.URL, DirectPath: &resp.DirectPath,
			MediaKey: resp.MediaKey, FileEncSHA256: resp.FileEncSHA256, FileSHA256: resp.FileSHA256, FileLength: &resp.FileLength,
		}}}
	case "video":
		return []*waE2E.Message{{VideoMessage: &waE2E.VideoMessage{
			Caption: proto.String(caption), Mimetype: proto.String(att.Mime), URL: &resp.URL, DirectPath: &resp.DirectPath,
			MediaKey: resp.MediaKey, FileEncSHA256: resp.FileEncSHA256, FileSHA256: resp.FileSHA256, FileLength: &resp.FileLength,
		}}}
	case "audio":
		messages := []*waE2E.Message{{AudioMessage: &waE2E.AudioMessage{
			Mimetype: proto.String(att.Mime), URL: &resp.URL, DirectPath: &resp.DirectPath, PTT: proto.Bool(false),
			MediaKey: resp.MediaKey, FileEncSHA256: resp.FileEncSHA256, FileSHA256: resp.FileSHA256, FileLength: &resp.FileLength,
		}}}
		if strings.TrimSpace(caption) != "" {
			messages = append(messages, &waE2E.Message{Conversation: proto.String(caption)})
		}
		return messages
	}
	return []*waE2E.Message{{DocumentMessage: &waE2E.DocumentMessage{
		Caption: proto.String(caption), Mimetype: proto.String(att.Mime), FileName: proto.String(att.Name), Title: proto.String(att.Name),
		URL: &resp.URL, DirectPath: &resp.DirectPath, MediaKey: resp.MediaKey, FileEncSHA256: resp.FileEncSHA256,
		FileSHA256: resp.FileSHA256, FileLength: &resp.FileLength,
	}}}
}

func (s *session) sendText(ctx context.Context, jid types.JID, text string) error {
	client := s.currentClient()
	if client == nil || !client.IsConnected() || !client.IsLoggedIn() || jid.Server != types.GroupServer {
		return errGroupUnavailable
	}
	message := &waE2E.Message{Conversation: proto.String(text)}
	sent, err := client.SendMessage(ctx, jid, message)
	if err == nil {
		s.recordOwnSend(client, jid, sent, message, attachment{})
	}
	return err
}

func (s *session) sendMedia(ctx context.Context, jid types.JID, att attachment, caption string) error {
	client := s.currentClient()
	if client == nil || !client.IsConnected() || !client.IsLoggedIn() || jid.Server != types.GroupServer {
		return errGroupUnavailable
	}
	resp, err := uploadAttachment(ctx, client, att, s.cfg.ScratchDir)
	if err != nil {
		return err
	}
	for i, message := range buildMediaMessages(att, caption, resp) {
		sent, err := client.SendMessage(ctx, jid, message)
		if err != nil {
			if i == 0 {
				return err
			}
			return nil
		}
		s.recordOwnSend(client, jid, sent, message, att)
	}
	return nil
}

// recordOwnSend stores a message this bridge sent, since WhatsApp does not echo it back. No media key or URL is kept, so it
// cannot be downloaded again. Failing to record never fails the send.
func (s *session) recordOwnSend(client *whatsmeow.Client, jid types.JID, sent whatsmeow.SendResponse, message *waE2E.Message, att attachment) {
	if sent.ID == "" {
		return
	}
	row := storedMessage{ID: sent.ID, ChatJID: jid.String(), FromMe: true}
	switch {
	case message.GetConversation() != "":
		row.Content = message.GetConversation()
	case message.GetImageMessage() != nil:
		row.MediaType, row.Content, row.FileLength = "image", message.GetImageMessage().GetCaption(), message.GetImageMessage().GetFileLength()
		row.FileName = att.Name
	case message.GetVideoMessage() != nil:
		row.MediaType, row.Content, row.FileLength = "video", message.GetVideoMessage().GetCaption(), message.GetVideoMessage().GetFileLength()
		row.FileName = att.Name
	case message.GetAudioMessage() != nil:
		row.MediaType, row.FileName, row.FileLength = "audio", att.Name, message.GetAudioMessage().GetFileLength()
	case message.GetDocumentMessage() != nil:
		doc := message.GetDocumentMessage()
		row.MediaType, row.Content, row.FileName, row.FileLength = "document", doc.GetCaption(), doc.GetFileName(), doc.GetFileLength()
	default:
		return
	}
	row.Sender = "me"
	if client.Store != nil && client.Store.ID != nil {
		row.Sender = client.Store.ID.ToNonAD().String()
	}
	row.Time = sent.Timestamp
	if row.Time.IsZero() {
		row.Time = time.Now()
	}
	if s.store.StoreMessage(row) == nil {
		_ = s.store.markSentByAgent(row.ID, row.ChatJID, row.Time)
	}
}
