package main

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	_ "modernc.org/sqlite"
)

// MessageStore keeps the chats and messages this device has seen. Times are Unix seconds.
type MessageStore struct {
	db *sql.DB
}

func openMessageStore(path string) (*MessageStore, error) {
	db, err := sql.Open("sqlite", "file:"+path+"?_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS chats (
			jid TEXT PRIMARY KEY,
			name TEXT,
			last_message_time INTEGER
		);
		CREATE TABLE IF NOT EXISTS messages (
			id TEXT,
			chat_jid TEXT,
			sender TEXT,
			sender_name TEXT,
			content TEXT,
			timestamp INTEGER,
			is_from_me BOOLEAN,
			media_type TEXT,
			filename TEXT,
			url TEXT,
			media_key BLOB,
			file_sha256 BLOB,
			file_enc_sha256 BLOB,
			file_length INTEGER,
			sent_by_agent BOOLEAN DEFAULT 0,
			PRIMARY KEY (id, chat_jid),
			FOREIGN KEY (chat_jid) REFERENCES chats(jid)
		);
		CREATE INDEX IF NOT EXISTS messages_chat_time ON messages (chat_jid, timestamp);
	`)
	if err != nil {
		db.Close()
		return nil, fmt.Errorf("tables: %w", err)
	}
	return &MessageStore{db: db}, nil
}

func (store *MessageStore) Close() error {
	return store.db.Close()
}

// StoreChat records a chat; a later time only moves its last-message time forward, and a known name is kept.
func (store *MessageStore) StoreChat(jid, name string, lastMessageTime time.Time) error {
	stamp := int64(0)
	if !lastMessageTime.IsZero() {
		stamp = lastMessageTime.Unix()
	}
	_, err := store.db.Exec(
		`INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)
		ON CONFLICT(jid) DO UPDATE SET
			name = CASE WHEN excluded.name != '' THEN excluded.name ELSE chats.name END,
			last_message_time = MAX(COALESCE(chats.last_message_time, 0), excluded.last_message_time)`,
		jid, name, stamp,
	)
	return err
}

func (store *MessageStore) chatName(jid string) string {
	var name sql.NullString
	if store.db.QueryRow(`SELECT name FROM chats WHERE jid = ?`, jid).Scan(&name) == nil && name.Valid {
		return name.String
	}
	return ""
}

type storedMessage struct {
	ID, ChatJID, Sender, SenderName, Content string
	Time                                     time.Time
	FromMe                                   bool
	MediaType, FileName, URL                 string
	MediaKey, FileSHA256, FileEncSHA256      []byte
	FileLength                               uint64
}

// StoreMessage is an upsert, not a replace: a later copy of a message must not clear what the bridge recorded of its own sends.
func (store *MessageStore) StoreMessage(m storedMessage) error {
	if m.Content == "" && m.MediaType == "" {
		return nil
	}
	_, err := store.db.Exec(
		`INSERT INTO messages
		(id, chat_jid, sender, sender_name, content, timestamp, is_from_me, media_type, filename, url, media_key, file_sha256, file_enc_sha256, file_length)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id, chat_jid) DO UPDATE SET sender = excluded.sender,
			sender_name = CASE WHEN excluded.sender_name != '' THEN excluded.sender_name ELSE messages.sender_name END,
			content = excluded.content, timestamp = excluded.timestamp, is_from_me = excluded.is_from_me,
			media_type = excluded.media_type, filename = excluded.filename,
			url = CASE WHEN excluded.url != '' THEN excluded.url ELSE messages.url END,
			media_key = COALESCE(excluded.media_key, messages.media_key),
			file_sha256 = COALESCE(excluded.file_sha256, messages.file_sha256),
			file_enc_sha256 = COALESCE(excluded.file_enc_sha256, messages.file_enc_sha256),
			file_length = excluded.file_length`,
		m.ID, m.ChatJID, m.Sender, m.SenderName, m.Content, m.Time.Unix(), m.FromMe, m.MediaType, m.FileName, m.URL,
		m.MediaKey, m.FileSHA256, m.FileEncSHA256, m.FileLength,
	)
	return err
}

// markSentByAgent flags a message this bridge sent for an agent, and moves its chat's last-message time forward.
func (store *MessageStore) markSentByAgent(id, chatJID string, stamp time.Time) error {
	if _, err := store.db.Exec(`UPDATE messages SET sent_by_agent = 1 WHERE id = ? AND chat_jid = ?`, id, chatJID); err != nil {
		return err
	}
	_, err := store.db.Exec(`UPDATE chats SET last_message_time = ? WHERE jid = ? AND (last_message_time IS NULL OR last_message_time < ?)`,
		stamp.Unix(), chatJID, stamp.Unix())
	return err
}

type mediaInfo struct {
	MediaType, FileName, URL            string
	MediaKey, FileSHA256, FileEncSHA256 []byte
	FileLength                          uint64
}

var errNoMessage = errors.New("no such message")

func (store *MessageStore) GetMediaInfo(id, chatJID string) (mediaInfo, error) {
	var info mediaInfo
	var mediaType, fileName, url sql.NullString
	var length sql.NullInt64
	err := store.db.QueryRow(
		`SELECT media_type, filename, url, media_key, file_sha256, file_enc_sha256, file_length FROM messages WHERE id = ? AND chat_jid = ?`,
		id, chatJID,
	).Scan(&mediaType, &fileName, &url, &info.MediaKey, &info.FileSHA256, &info.FileEncSHA256, &length)
	if errors.Is(err, sql.ErrNoRows) {
		return info, errNoMessage
	}
	info.MediaType, info.FileName, info.URL = mediaType.String, fileName.String, url.String
	if length.Valid && length.Int64 > 0 {
		info.FileLength = uint64(length.Int64)
	}
	return info, err
}
