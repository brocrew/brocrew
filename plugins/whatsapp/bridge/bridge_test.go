package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func realDir(t *testing.T) string {
	t.Helper()
	dir, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return dir
}

func fileRequest(t *testing.T, path string, data []byte, name string) sendFile {
	t.Helper()
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(data)
	return sendFile{Path: path, Name: name, Size: int64(len(data)), SHA256: hex.EncodeToString(sum[:])}
}

func TestAnAttachmentComesOnlyFromTheFilesFolder(t *testing.T) {
	root := realDir(t)
	files := filepath.Join(root, "files")
	if err := os.Mkdir(files, 0o700); err != nil {
		t.Fatal(err)
	}
	pdf := []byte("%PDF-1.7\nfictional notes\n")
	inside := fileRequest(t, filepath.Join(files, "notes.pdf"), pdf, "notes.pdf")
	att, code := openAttachment(files, inside)
	if code != "" || att.Mime != "application/pdf" || att.Name != "notes.pdf" {
		t.Fatalf("a PDF in the files folder was refused: %q %+v", code, att)
	}
	att.File.Close()

	outside := fileRequest(t, filepath.Join(root, "elsewhere.pdf"), pdf, "elsewhere.pdf")
	if _, code := openAttachment(files, outside); code != "outside" {
		t.Fatalf("a file outside the folder: %q", code)
	}
	link := filepath.Join(files, "link.pdf")
	if err := os.Symlink(outside.Path, link); err != nil {
		t.Fatal(err)
	}
	if _, code := openAttachment(files, sendFile{Path: link, Name: "link.pdf", Size: inside.Size, SHA256: inside.SHA256}); code != "outside" {
		t.Fatalf("a link out of the folder: %q", code)
	}
	if _, code := openAttachment(files, sendFile{Path: files + "/../elsewhere.pdf", Name: "x.pdf", Size: inside.Size, SHA256: inside.SHA256}); code != "outside" {
		t.Fatalf("a path that climbs out: %q", code)
	}
	changed := inside
	changed.SHA256 = strings.Repeat("0", 64)
	if _, code := openAttachment(files, changed); code != "changed" {
		t.Fatalf("a file whose bytes changed: %q", code)
	}
	hard := filepath.Join(files, "second-name.pdf")
	if err := os.Link(inside.Path, hard); err != nil {
		t.Fatal(err)
	}
	if _, code := openAttachment(files, inside); code != "invalid_request" {
		t.Fatalf("a hard-linked file: %q", code)
	}
	fake := fileRequest(t, filepath.Join(files, "report.pdf"), []byte("not a pdf at all"), "report.pdf")
	if _, code := openAttachment(files, fake); code != "unsupported_media_type" {
		t.Fatalf("a .pdf that is no PDF: %q", code)
	}
}

func TestAQRCodeIsAPatternOnly(t *testing.T) {
	view, err := qrPattern("fictional-pairing-payload,abc,def,ghi", time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if view.Size < 21 || len(view.Bits) != view.Size*view.Size || strings.Trim(view.Bits, "01") != "" {
		t.Fatalf("not a square bit pattern: size %d, %d bits", view.Size, len(view.Bits))
	}
	if strings.Contains(view.Bits, "fictional") || view.ExpiresAt <= time.Now().UnixMilli() {
		t.Fatal("the pattern carries the payload or no future expiry")
	}
}

func fictionalStore(t *testing.T) *MessageStore {
	t.Helper()
	store, err := openMessageStore(filepath.Join(t.TempDir(), "messages.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	base := time.Unix(1_800_000_000, 0)
	chats := []struct{ jid, name string }{
		{"120363000000000001@g.us", "Harbour Rowing Club"},
		{"15550000001@s.whatsapp.net", "Ines Calder"},
		{"15550000002@s.whatsapp.net", "50% Off Bakery"},
	}
	for i, c := range chats {
		if err := store.StoreChat(c.jid, c.name, base.Add(time.Duration(i)*time.Hour)); err != nil {
			t.Fatal(err)
		}
	}
	messages := []storedMessage{
		{ID: "MSG00001", ChatJID: chats[0].jid, Sender: chats[1].jid, SenderName: "Ines", Content: "Training moves to Thursday", Time: base},
		{ID: "MSG00002", ChatJID: chats[0].jid, Sender: chats[2].jid, Content: "Thursday works", Time: base.Add(time.Minute)},
		{ID: "MSG00003", ChatJID: chats[0].jid, Sender: chats[1].jid, MediaType: "image", Time: base.Add(2 * time.Minute)},
		{ID: "MSG00004", ChatJID: chats[1].jid, Sender: chats[1].jid, Content: "See you at the boathouse", Time: base.Add(3 * time.Minute)},
	}
	for _, m := range messages {
		if err := store.StoreMessage(m); err != nil {
			t.Fatal(err)
		}
	}
	return store
}

func TestReadingTheStore(t *testing.T) {
	store := fictionalStore(t)
	chats, err := store.listChats(listQuery{Query: "rowing"})
	if err != nil || len(chats) != 1 || !chats[0].Group || chats[0].Name != "Harbour Rowing Club" {
		t.Fatalf("chat search: %+v %v", chats, err)
	}
	if chats, _ := store.listChats(listQuery{Query: "%"}); len(chats) != 1 || chats[0].Name != "50% Off Bakery" {
		t.Fatalf("a %% in a search matches only itself: %+v", chats)
	}
	messages, err := store.listMessages(listQuery{Chat: "120363000000000001@g.us"})
	if err != nil || len(messages) != 3 || messages[0].ID != "MSG00003" || messages[2].SenderName != "Ines" {
		t.Fatalf("messages of one chat, newest first: %+v %v", messages, err)
	}
	if messages[1].SenderName != "50% Off Bakery" {
		t.Fatalf("a sender with no name of their own goes by their chat's name: %+v", messages[1])
	}
	found, _ := store.listMessages(listQuery{Query: "thursday"})
	if len(found) != 2 {
		t.Fatalf("search across chats: %+v", found)
	}
	window, _ := store.listMessages(listQuery{Chat: "120363000000000001@g.us", After: 1_800_000_000, Before: 1_800_000_120})
	if len(window) != 1 || window[0].ID != "MSG00002" {
		t.Fatalf("messages between two times: %+v", window)
	}
	if _, err := store.GetMediaInfo("MSG09999", "120363000000000001@g.us"); err != errNoMessage {
		t.Fatalf("an unknown message: %v", err)
	}
	contacts, _ := store.searchContacts("c")
	for _, c := range contacts {
		if strings.HasSuffix(c.JID, "@g.us") {
			t.Fatal("a group listed as a contact")
		}
	}
}

func TestAnOwnSendIsRecordedAsSentByAnAgent(t *testing.T) {
	store := fictionalStore(t)
	stamp := time.Unix(1_800_100_000, 0)
	if err := store.StoreMessage(storedMessage{ID: "OWN00001", ChatJID: "120363000000000001@g.us", Sender: "me", Content: "🤖 Boats are booked", FromMe: true, Time: stamp}); err != nil {
		t.Fatal(err)
	}
	if err := store.markSentByAgent("OWN00001", "120363000000000001@g.us", stamp); err != nil {
		t.Fatal(err)
	}
	// A later copy of the same message must not clear the flag.
	if err := store.StoreMessage(storedMessage{ID: "OWN00001", ChatJID: "120363000000000001@g.us", Sender: "me", Content: "🤖 Boats are booked", FromMe: true, Time: stamp}); err != nil {
		t.Fatal(err)
	}
	messages, _ := store.listMessages(listQuery{Chat: "120363000000000001@g.us", Limit: 1})
	if len(messages) != 1 || !messages[0].SentByAgent || !messages[0].FromMe {
		t.Fatalf("own send: %+v", messages)
	}
	chats, _ := store.listChats(listQuery{})
	if chats[0].JID != "120363000000000001@g.us" {
		t.Fatal("the chat did not move to the top")
	}
}

func TestAPersonIsNeverAGroup(t *testing.T) {
	s := &session{state: stateLinked}
	for _, jid := range []string{"15550000001@s.whatsapp.net", "15550000001@lid", "status@broadcast", "not a jid", "120363000000000001:2@g.us"} {
		if _, ok := s.groupFor(context.Background(), jid); ok {
			t.Fatalf("%s was taken for a group", jid)
		}
	}
}

func TestTheAPIAnswersOnlyItsToken(t *testing.T) {
	token := strings.Repeat("t", 40)
	s := &session{state: stateUnlinked}
	api := newAPI(config{Token: token}, s, func() {})
	for _, c := range []struct {
		header, origin string
		want           int
	}{
		{"", "", http.StatusUnauthorized},
		{"Bearer " + strings.Repeat("x", 40), "", http.StatusUnauthorized},
		{"Bearer " + token, "http://example.invalid", http.StatusUnauthorized},
		{"Bearer " + token, "", http.StatusOK},
	} {
		request := httptest.NewRequest(http.MethodGet, "/status", nil)
		if c.header != "" {
			request.Header.Set("Authorization", c.header)
		}
		if c.origin != "" {
			request.Header.Set("Origin", c.origin)
		}
		response := httptest.NewRecorder()
		api.ServeHTTP(response, request)
		if response.Code != c.want {
			t.Fatalf("%q/%q: %d", c.header, c.origin, response.Code)
		}
		if c.want == http.StatusOK {
			var view statusView
			if json.Unmarshal(response.Body.Bytes(), &view) != nil || view.State != stateUnlinked || view.QR != nil {
				t.Fatalf("status: %s", response.Body.String())
			}
		}
	}
	logout := httptest.NewRequest(http.MethodPost, "/unlink", strings.NewReader(`{}`))
	logout.Header.Set("Authorization", "Bearer "+token)
	logout.Header.Set("Content-Type", "application/json")
	answer := httptest.NewRecorder()
	api.ServeHTTP(answer, logout)
	if answer.Code != http.StatusOK || strings.TrimSpace(answer.Body.String()) != `{"confirmed":true,"ok":true}` {
		t.Fatalf("logging out with nothing linked: %d %s", answer.Code, answer.Body.String())
	}
	request := httptest.NewRequest(http.MethodPost, "/send", strings.NewReader(`{"group":"x","text":"hello","extra":1}`))
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	api.ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("an unknown field: %d", response.Code)
	}
}
