package main

import (
	"database/sql"
	"strings"
)

type chatRow struct {
	JID        string `json:"jid"`
	Name       string `json:"name"`
	Group      bool   `json:"group"`
	LastTime   int64  `json:"lastTime"`
	LastText   string `json:"lastText"`
	LastFromMe bool   `json:"lastFromMe"`
}

type messageRow struct {
	ID          string `json:"id"`
	Chat        string `json:"chat"`
	ChatName    string `json:"chatName"`
	Time        int64  `json:"time"`
	Sender      string `json:"sender"`
	SenderName  string `json:"senderName"`
	FromMe      bool   `json:"fromMe"`
	Text        string `json:"text"`
	Media       string `json:"media,omitempty"`
	FileName    string `json:"fileName,omitempty"`
	Size        int64  `json:"size,omitempty"`
	SentByAgent bool   `json:"sentByAgent,omitempty"`
}

type contactRow struct {
	JID  string `json:"jid"`
	Name string `json:"name"`
}

type listQuery struct {
	Query  string `json:"query"`
	Chat   string `json:"chat"`
	Before int64  `json:"before"`
	After  int64  `json:"after"`
	Limit  int    `json:"limit"`
	Page   int    `json:"page"`
}

func bounded(limit, fallback, most int) int {
	if limit <= 0 {
		return fallback
	}
	if limit > most {
		return most
	}
	return limit
}

// like escapes a search for LIKE, so % and _ in what was asked match themselves.
func like(text string) string {
	text = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(text)
	return "%" + text + "%"
}

func (store *MessageStore) listChats(q listQuery) ([]chatRow, error) {
	limit := bounded(q.Limit, 20, 100)
	page := max(q.Page, 0)
	args := []any{}
	where := ""
	if q.Query != "" {
		where = `WHERE (LOWER(chats.name) LIKE LOWER(?) ESCAPE '\' OR chats.jid LIKE ? ESCAPE '\')`
		args = append(args, like(q.Query), like(q.Query))
	}
	args = append(args, limit, page*limit)
	rows, err := store.db.Query(`
		SELECT chats.jid, COALESCE(chats.name, ''), COALESCE(chats.last_message_time, 0),
			COALESCE((SELECT content FROM messages m WHERE m.chat_jid = chats.jid ORDER BY m.timestamp DESC LIMIT 1), ''),
			COALESCE((SELECT is_from_me FROM messages m WHERE m.chat_jid = chats.jid ORDER BY m.timestamp DESC LIMIT 1), 0)
		FROM chats `+where+`
		ORDER BY chats.last_message_time DESC LIMIT ? OFFSET ?`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []chatRow{}
	for rows.Next() {
		var row chatRow
		if err := rows.Scan(&row.JID, &row.Name, &row.LastTime, &row.LastText, &row.LastFromMe); err != nil {
			return nil, err
		}
		row.Group = strings.HasSuffix(row.JID, "@g.us")
		result = append(result, row)
	}
	return result, rows.Err()
}

const messageColumns = `messages.id, messages.chat_jid, COALESCE(chats.name, ''), COALESCE(messages.timestamp, 0),
	COALESCE(messages.sender, ''),
	COALESCE(NULLIF(messages.sender_name, ''), (SELECT name FROM chats sender WHERE sender.jid = messages.sender), ''),
	COALESCE(messages.is_from_me, 0),
	COALESCE(messages.content, ''), COALESCE(messages.media_type, ''), COALESCE(messages.filename, ''),
	COALESCE(messages.file_length, 0), COALESCE(messages.sent_by_agent, 0)`

func scanMessages(rows *sql.Rows) ([]messageRow, error) {
	defer rows.Close()
	result := []messageRow{}
	for rows.Next() {
		var row messageRow
		if err := rows.Scan(&row.ID, &row.Chat, &row.ChatName, &row.Time, &row.Sender, &row.SenderName, &row.FromMe,
			&row.Text, &row.Media, &row.FileName, &row.Size, &row.SentByAgent); err != nil {
			return nil, err
		}
		result = append(result, row)
	}
	return result, rows.Err()
}

func (store *MessageStore) listMessages(q listQuery) ([]messageRow, error) {
	limit := bounded(q.Limit, 20, 100)
	page := max(q.Page, 0)
	clauses := []string{}
	args := []any{}
	if q.Chat != "" {
		clauses = append(clauses, "messages.chat_jid = ?")
		args = append(args, q.Chat)
	}
	if q.After > 0 {
		clauses = append(clauses, "messages.timestamp > ?")
		args = append(args, q.After)
	}
	if q.Before > 0 {
		clauses = append(clauses, "messages.timestamp < ?")
		args = append(args, q.Before)
	}
	if q.Query != "" {
		clauses = append(clauses, `LOWER(messages.content) LIKE LOWER(?) ESCAPE '\'`)
		args = append(args, like(q.Query))
	}
	where := ""
	if len(clauses) > 0 {
		where = "WHERE " + strings.Join(clauses, " AND ")
	}
	args = append(args, limit, page*limit)
	rows, err := store.db.Query(`SELECT `+messageColumns+` FROM messages JOIN chats ON messages.chat_jid = chats.jid `+where+`
		ORDER BY messages.timestamp DESC LIMIT ? OFFSET ?`, args...)
	if err != nil {
		return nil, err
	}
	return scanMessages(rows)
}

func (store *MessageStore) searchContacts(query string) ([]contactRow, error) {
	rows, err := store.db.Query(`SELECT jid, COALESCE(name, '') FROM chats
		WHERE (LOWER(name) LIKE LOWER(?) ESCAPE '\' OR LOWER(jid) LIKE LOWER(?) ESCAPE '\') AND jid NOT LIKE '%@g.us'
		ORDER BY name, jid LIMIT 50`, like(query), like(query))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []contactRow{}
	for rows.Next() {
		var row contactRow
		if err := rows.Scan(&row.JID, &row.Name); err != nil {
			return nil, err
		}
		result = append(result, row)
	}
	return result, rows.Err()
}
