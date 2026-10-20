package main

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	wastore "go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
	"rsc.io/qr"
)

// The states the settings page shows: not linked, a QR code on screen, connecting, linked.
const (
	stateUnlinked   = "unlinked"
	statePairing    = "pairing"
	stateConnecting = "connecting"
	stateLinked     = "linked"
)

type qrView struct {
	Size      int    `json:"size"`
	Bits      string `json:"bits"`
	ExpiresAt int64  `json:"expiresAt"`
}

type statusView struct {
	State   string  `json:"state"`
	Expired bool    `json:"expired"`
	Account string  `json:"account"`
	QR      *qrView `json:"qr,omitempty"`
}

type groupView struct {
	JID  string `json:"jid"`
	Name string `json:"name"`
}

type session struct {
	cfg       config
	container *sqlstore.Container
	store     *MessageStore
	sends     groupLimiter
	unlinked  func()

	mu      sync.Mutex
	client  *whatsmeow.Client
	state   string
	expired bool
	qr      *qrView
	pairing context.CancelFunc
	groups  []groupView
	groupAt time.Time
}

func openSession(cfg config, unlinked func()) (*session, error) {
	ctx := context.Background()
	container, err := sqlstore.New(ctx, "sqlite",
		"file:"+filepath.Join(cfg.DataDir, "session.db")+"?_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)", waLog.Noop)
	if err != nil {
		return nil, err
	}
	store, err := openMessageStore(filepath.Join(cfg.DataDir, "messages.db"))
	if err != nil {
		_ = container.Close()
		return nil, err
	}
	s := &session{cfg: cfg, container: container, store: store, state: stateUnlinked, unlinked: unlinked}
	device, err := container.GetFirstDevice(ctx)
	if err != nil {
		s.close()
		return nil, err
	}
	s.setClient(device)
	if device.ID != nil {
		s.state = stateConnecting
		go func() { _ = s.currentClient().Connect() }()
	}
	return s, nil
}

func (s *session) setClient(device *wastore.Device) {
	client := whatsmeow.NewClient(device, waLog.Noop)
	// A first connection that fails, say while the Mac is offline, keeps retrying instead of staying down.
	client.InitialAutoReconnect = true
	client.SetMediaHTTPClient(boundedMediaClient())
	client.AddEventHandler(func(evt interface{}) { s.handleEvent(client, evt) })
	s.mu.Lock()
	s.client = client
	s.mu.Unlock()
}

func (s *session) currentClient() *whatsmeow.Client {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.client
}

func (s *session) status() statusView {
	s.mu.Lock()
	defer s.mu.Unlock()
	view := statusView{State: s.state, Expired: s.expired}
	if s.state == statePairing && s.qr != nil {
		copied := *s.qr
		view.QR = &copied
	}
	if s.state == stateLinked && s.client != nil && s.client.Store != nil {
		view.Account = s.client.Store.PushName
	}
	return view
}

func (s *session) linked() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.state == stateLinked && s.client != nil && s.client.IsConnected() && s.client.IsLoggedIn()
}

var errBusyState = errors.New("not in a state that allows this")

// pair starts showing QR codes. The code rotates; it never leaves the bridge except as the module pattern to draw.
func (s *session) pair() error {
	s.mu.Lock()
	if s.state != stateUnlinked || s.client == nil || s.client.Store.ID != nil {
		s.mu.Unlock()
		return errBusyState
	}
	client := s.client
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	s.pairing = cancel
	s.state = statePairing
	s.expired = false
	s.qr = nil
	s.mu.Unlock()
	codes, err := client.GetQRChannel(ctx)
	if err == nil {
		err = client.Connect()
	}
	if err != nil {
		cancel()
		s.pairingEnded(client, true)
		return err
	}
	go func() {
		defer cancel()
		for item := range codes {
			switch item.Event {
			case whatsmeow.QRChannelEventCode:
				view, err := qrPattern(item.Code, item.Timeout)
				s.mu.Lock()
				if err == nil && s.client == client && s.state == statePairing {
					s.qr = view
				}
				s.mu.Unlock()
			case whatsmeow.QRChannelSuccess.Event:
				s.mu.Lock()
				if s.client == client {
					s.state, s.qr = stateConnecting, nil
				}
				s.mu.Unlock()
				return
			default:
				s.pairingEnded(client, true)
				return
			}
		}
		s.pairingEnded(client, true)
	}()
	return nil
}

func (s *session) pairingEnded(client *whatsmeow.Client, expired bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.client != client || s.state != statePairing {
		return
	}
	client.Disconnect()
	s.state, s.qr, s.expired = stateUnlinked, nil, expired
}

func qrPattern(code string, timeout time.Duration) (*qrView, error) {
	encoded, err := qr.Encode(code, qr.L)
	if err != nil {
		return nil, err
	}
	var bits strings.Builder
	bits.Grow(encoded.Size * encoded.Size)
	for y := 0; y < encoded.Size; y++ {
		for x := 0; x < encoded.Size; x++ {
			if encoded.Black(x, y) {
				bits.WriteByte('1')
			} else {
				bits.WriteByte('0')
			}
		}
	}
	return &qrView{Size: encoded.Size, Bits: bits.String(), ExpiresAt: time.Now().Add(timeout).UnixMilli()}, nil
}

// unlink logs this device out on WhatsApp's side, so the phone's Linked devices list drops it; the Node server then deletes
// the data folder. Logout needs a connection, so a bridge that is reconnecting connects first and waits up to 15 seconds.
// When WhatsApp still can't be reached, only this side is cleared. It reports whether WhatsApp confirmed the removal.
func (s *session) unlink() bool {
	s.mu.Lock()
	client := s.client
	if s.pairing != nil {
		s.pairing()
	}
	s.mu.Unlock()
	if client == nil {
		return true
	}
	if client.Store.ID == nil {
		client.Disconnect()
		return true
	}
	if !client.IsLoggedIn() {
		_ = client.Connect()
		for until := time.Now().Add(15 * time.Second); !client.IsLoggedIn() && time.Now().Before(until); {
			time.Sleep(100 * time.Millisecond)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if client.Logout(ctx) != nil {
		client.Disconnect()
		return false
	}
	return true
}

func (s *session) close() {
	s.mu.Lock()
	client := s.client
	if s.pairing != nil {
		s.pairing()
	}
	s.mu.Unlock()
	if client != nil {
		client.Disconnect()
	}
	if s.store != nil {
		_ = s.store.Close()
	}
	if s.container != nil {
		_ = s.container.Close()
	}
}

func (s *session) handleEvent(client *whatsmeow.Client, evt interface{}) {
	switch v := evt.(type) {
	case *events.Message:
		s.storeIncoming(client, v)
	case *events.HistorySync:
		s.storeHistory(client, v)
	case *events.Connected:
		s.mu.Lock()
		if s.client == client {
			s.state, s.qr, s.expired = stateLinked, nil, false
		}
		s.mu.Unlock()
	case *events.Disconnected:
		s.mu.Lock()
		if s.client == client && s.state == stateLinked {
			s.state = stateConnecting
		}
		s.mu.Unlock()
	case *events.LoggedOut:
		// The phone removed this device. The bridge stops, and the Node server deletes this account's messages with the session.
		s.mu.Lock()
		current := s.client == client
		if current {
			s.state, s.qr, s.groups = stateUnlinked, nil, nil
		}
		s.mu.Unlock()
		if current {
			s.unlinked()
		}
	}
}

// groupsFor caches the account's groups for 30 seconds unless the person asks to refresh.
func (s *session) groupsFor(ctx context.Context, refresh bool) ([]groupView, error) {
	s.mu.Lock()
	if !refresh && s.groups != nil && time.Since(s.groupAt) < 30*time.Second {
		groups := append([]groupView(nil), s.groups...)
		s.mu.Unlock()
		return groups, nil
	}
	client := s.client
	s.mu.Unlock()
	if client == nil || !client.IsLoggedIn() {
		return nil, errBusyState
	}
	joined, err := client.GetJoinedGroups(ctx)
	if err != nil {
		return nil, err
	}
	groups := make([]groupView, 0, len(joined))
	for _, group := range joined {
		if group == nil || group.JID.Server != types.GroupServer || len(groups) >= 1024 {
			continue
		}
		groups = append(groups, groupView{JID: group.JID.String(), Name: cleanName(group.Name, group.JID.User)})
		_ = s.store.StoreChat(group.JID.String(), cleanName(group.Name, ""), time.Time{})
	}
	s.mu.Lock()
	if s.client == client {
		s.groups, s.groupAt = groups, time.Now()
	}
	s.mu.Unlock()
	return groups, nil
}

// cleanName keeps a name on one line, bounded.
func cleanName(name, fallback string) string {
	name = strings.Join(strings.Fields(name), " ")
	if r := []rune(name); len(r) > 120 {
		name = string(r[:120])
	}
	if name == "" {
		return fallback
	}
	return name
}

func extractText(msg *waE2E.Message) string {
	if msg == nil {
		return ""
	}
	switch {
	case msg.GetConversation() != "":
		return msg.GetConversation()
	case msg.GetExtendedTextMessage() != nil:
		return msg.GetExtendedTextMessage().GetText()
	case msg.GetImageMessage() != nil:
		return msg.GetImageMessage().GetCaption()
	case msg.GetVideoMessage() != nil:
		return msg.GetVideoMessage().GetCaption()
	case msg.GetDocumentMessage() != nil:
		return msg.GetDocumentMessage().GetCaption()
	}
	return ""
}

func extractMedia(msg *waE2E.Message) mediaInfo {
	if msg == nil {
		return mediaInfo{}
	}
	if img := msg.GetImageMessage(); img != nil {
		return mediaInfo{MediaType: "image", URL: img.GetURL(), MediaKey: img.GetMediaKey(), FileSHA256: img.GetFileSHA256(),
			FileEncSHA256: img.GetFileEncSHA256(), FileLength: img.GetFileLength()}
	}
	if vid := msg.GetVideoMessage(); vid != nil {
		return mediaInfo{MediaType: "video", FileLength: vid.GetFileLength()}
	}
	if aud := msg.GetAudioMessage(); aud != nil {
		return mediaInfo{MediaType: "audio", FileLength: aud.GetFileLength()}
	}
	if doc := msg.GetDocumentMessage(); doc != nil {
		return mediaInfo{MediaType: "document", FileName: cleanName(doc.GetFileName(), "document"), URL: doc.GetURL(),
			MediaKey: doc.GetMediaKey(), FileSHA256: doc.GetFileSHA256(), FileEncSHA256: doc.GetFileEncSHA256(), FileLength: doc.GetFileLength()}
	}
	return mediaInfo{}
}

func ignoredChat(jid types.JID) bool {
	return jid.Server == types.BroadcastServer || jid.Server == types.NewsletterServer
}

func (s *session) storeIncoming(client *whatsmeow.Client, msg *events.Message) {
	if msg == nil || ignoredChat(msg.Info.Chat) {
		return
	}
	chatJID := msg.Info.Chat.String()
	name := s.chatNameFor(client, msg.Info.Chat, "", msg.Info.PushName)
	_ = s.store.StoreChat(chatJID, name, msg.Info.Timestamp)
	media := extractMedia(msg.Message)
	_ = s.store.StoreMessage(storedMessage{
		ID: msg.Info.ID, ChatJID: chatJID, Sender: msg.Info.Sender.ToNonAD().String(), SenderName: cleanName(msg.Info.PushName, ""),
		Content: extractText(msg.Message), Time: msg.Info.Timestamp, FromMe: msg.Info.IsFromMe,
		MediaType: media.MediaType, FileName: media.FileName, URL: media.URL, MediaKey: media.MediaKey,
		FileSHA256: media.FileSHA256, FileEncSHA256: media.FileEncSHA256, FileLength: media.FileLength,
	})
}

// chatNameFor is the stored name, else the group's subject or the contact's name.
func (s *session) chatNameFor(client *whatsmeow.Client, jid types.JID, fromHistory, pushName string) string {
	if name := s.store.chatName(jid.String()); name != "" {
		return name
	}
	if name := cleanName(fromHistory, ""); name != "" {
		return name
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if jid.Server == types.GroupServer {
		if info, err := client.GetGroupInfo(ctx, jid); err == nil && info.Name != "" {
			return cleanName(info.Name, "")
		}
		return "Group " + jid.User
	}
	if contact, err := client.Store.Contacts.GetContact(ctx, jid); err == nil {
		for _, name := range []string{contact.FullName, contact.PushName, contact.BusinessName} {
			if name = cleanName(name, ""); name != "" {
				return name
			}
		}
	}
	if pushName = cleanName(pushName, ""); pushName != "" && jid.Server != types.GroupServer {
		return pushName
	}
	return jid.User
}

func (s *session) storeHistory(client *whatsmeow.Client, sync *events.HistorySync) {
	if sync == nil || sync.Data == nil {
		return
	}
	for _, conversation := range sync.Data.GetConversations() {
		jid, err := types.ParseJID(conversation.GetID())
		if err != nil || ignoredChat(jid) {
			continue
		}
		messages := conversation.GetMessages()
		if len(messages) == 0 || messages[0].GetMessage().GetMessageTimestamp() == 0 {
			continue
		}
		chatJID := jid.String()
		name := s.chatNameFor(client, jid, firstNonEmpty(conversation.GetDisplayName(), conversation.GetName()), "")
		_ = s.store.StoreChat(chatJID, name, time.Unix(int64(messages[0].GetMessage().GetMessageTimestamp()), 0))
		for _, item := range messages {
			info := item.GetMessage()
			if info == nil || info.GetMessageTimestamp() == 0 || info.GetKey().GetID() == "" {
				continue
			}
			key := info.GetKey()
			fromMe := key.GetFromMe()
			sender := jid.String()
			switch {
			case !fromMe && info.GetParticipant() != "":
				sender = info.GetParticipant()
			case !fromMe && key.GetParticipant() != "":
				sender = key.GetParticipant()
			case fromMe && client.Store.ID != nil:
				sender = client.Store.ID.ToNonAD().String()
			}
			media := extractMedia(info.GetMessage())
			_ = s.store.StoreMessage(storedMessage{
				ID: key.GetID(), ChatJID: chatJID, Sender: sender, SenderName: cleanName(info.GetPushName(), ""),
				Content: extractText(info.GetMessage()), Time: time.Unix(int64(info.GetMessageTimestamp()), 0), FromMe: fromMe,
				MediaType: media.MediaType, FileName: media.FileName, URL: media.URL, MediaKey: media.MediaKey,
				FileSHA256: media.FileSHA256, FileEncSHA256: media.FileEncSHA256, FileLength: media.FileLength,
			})
		}
	}
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
