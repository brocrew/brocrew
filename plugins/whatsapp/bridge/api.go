package main

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"strings"
	"sync"
	"time"
)

const requestBodyLimit = 20000

// decodeJSONBody reads exactly one bounded JSON object with only known fields; the result is a fixed code, or "".
func decodeJSONBody(w http.ResponseWriter, r *http.Request, into any) string {
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		return "unsupported_media_type"
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, requestBodyLimit))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(into); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			return "payload_too_large"
		}
		return "invalid_request"
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return "invalid_request"
	}
	return ""
}

func statusFor(code string) int {
	switch code {
	case "unsupported_media_type":
		return http.StatusUnsupportedMediaType
	case "payload_too_large", "too_large":
		return http.StatusRequestEntityTooLarge
	case "unknown_group", "not_found":
		return http.StatusNotFound
	case "not_connected", "unavailable":
		return http.StatusServiceUnavailable
	case "rate_limited", "busy":
		return http.StatusTooManyRequests
	case "send_failed", "download_failed":
		return http.StatusBadGateway
	case "no_media", "state":
		return http.StatusConflict
	}
	return http.StatusBadRequest
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeCode(w http.ResponseWriter, code string) {
	writeJSON(w, statusFor(code), map[string]string{"error": code})
}

// newAPI serves only the Node server that started this process: loopback, one token, no browser origin.
func newAPI(cfg config, s *session, unlinked func()) http.Handler {
	expected := sha256.Sum256([]byte(cfg.Token))
	authorized := func(r *http.Request) bool {
		header := r.Header.Get("Authorization")
		if r.Header.Get("Origin") != "" || !strings.HasPrefix(header, "Bearer ") {
			return false
		}
		presented := sha256.Sum256([]byte(strings.TrimPrefix(header, "Bearer ")))
		return subtle.ConstantTimeCompare(presented[:], expected[:]) == 1
	}
	mux := http.NewServeMux()
	busy := make(chan struct{}, 1)
	downloads := make(chan struct{}, 2)
	var unlinking sync.Once
	post := func(path string, handle func(http.ResponseWriter, *http.Request)) {
		mux.HandleFunc(path, func(w http.ResponseWriter, r *http.Request) {
			if !authorized(r) {
				writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
				return
			}
			if r.Method != http.MethodPost {
				w.Header().Set("Allow", http.MethodPost)
				writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
				return
			}
			handle(w, r)
		})
	}
	mux.HandleFunc("/status", func(w http.ResponseWriter, r *http.Request) {
		if !authorized(r) {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		writeJSON(w, http.StatusOK, s.status())
	})
	post("/pair", func(w http.ResponseWriter, r *http.Request) {
		var empty struct{}
		if code := decodeJSONBody(w, r, &empty); code != "" {
			writeCode(w, code)
			return
		}
		if err := s.pair(); err != nil {
			writeCode(w, "state")
			return
		}
		writeJSON(w, http.StatusOK, s.status())
	})
	post("/unlink", func(w http.ResponseWriter, r *http.Request) {
		var empty struct{}
		if code := decodeJSONBody(w, r, &empty); code != "" {
			writeCode(w, code)
			return
		}
		unlinking.Do(func() {
			confirmed := s.unlink()
			writeJSON(w, http.StatusOK, map[string]bool{"ok": true, "confirmed": confirmed})
			unlinked()
		})
	})
	post("/groups", func(w http.ResponseWriter, r *http.Request) {
		var query struct {
			Refresh bool `json:"refresh"`
		}
		if code := decodeJSONBody(w, r, &query); code != "" {
			writeCode(w, code)
			return
		}
		if !s.linked() {
			writeCode(w, "not_connected")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
		defer cancel()
		groups, err := s.groupsFor(ctx, query.Refresh)
		if err != nil {
			writeCode(w, "unavailable")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"groups": groups})
	})
	post("/chats", func(w http.ResponseWriter, r *http.Request) {
		var q listQuery
		if code := decodeJSONBody(w, r, &q); code != "" {
			writeCode(w, code)
			return
		}
		rows, err := s.store.listChats(q)
		if err != nil {
			writeCode(w, "unavailable")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"chats": rows})
	})
	post("/messages", func(w http.ResponseWriter, r *http.Request) {
		var q listQuery
		if code := decodeJSONBody(w, r, &q); code != "" {
			writeCode(w, code)
			return
		}
		rows, err := s.store.listMessages(q)
		if err != nil {
			writeCode(w, "unavailable")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"messages": rows})
	})
	post("/contacts", func(w http.ResponseWriter, r *http.Request) {
		var q listQuery
		if code := decodeJSONBody(w, r, &q); code != "" {
			writeCode(w, code)
			return
		}
		rows, err := s.store.searchContacts(q.Query)
		if err != nil {
			writeCode(w, "unavailable")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"contacts": rows})
	})
	post("/media", func(w http.ResponseWriter, r *http.Request) {
		var request mediaRequest
		if code := decodeJSONBody(w, r, &request); code != "" {
			writeCode(w, code)
			return
		}
		select {
		case downloads <- struct{}{}:
			defer func() { <-downloads }()
		default:
			writeCode(w, "busy")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
		defer cancel()
		result, code := s.downloadMedia(ctx, request)
		if code != "" {
			writeCode(w, code)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	post("/send", func(w http.ResponseWriter, r *http.Request) {
		var request sendRequest
		if code := decodeJSONBody(w, r, &request); code != "" {
			writeCode(w, code)
			return
		}
		hasFile := request.File != nil
		limit := groupSendTextRunes
		if hasFile {
			limit = attachmentCaptionRunes
		}
		if !validText(request.Text, limit, !hasFile) {
			writeCode(w, "invalid_message")
			return
		}
		if !s.linked() {
			writeCode(w, "not_connected")
			return
		}
		lookup, cancelLookup := context.WithTimeout(r.Context(), 15*time.Second)
		jid, ok := s.groupFor(lookup, request.Group)
		cancelLookup()
		if !ok {
			writeCode(w, "unknown_group")
			return
		}
		if !s.sends.reserve(time.Now()) {
			writeCode(w, "rate_limited")
			return
		}
		timeout := groupSendTimeout
		var att attachment
		if hasFile {
			select {
			case busy <- struct{}{}:
				defer func() { <-busy }()
			default:
				writeCode(w, "busy")
				return
			}
			loaded, code := openAttachment(cfg.FilesDir, *request.File)
			if code != "" {
				writeCode(w, code)
				return
			}
			att = loaded
			defer att.File.Close()
			timeout = attachmentSendTimeout
		}
		ctx, cancel := context.WithTimeout(r.Context(), timeout)
		defer cancel()
		var err error
		if hasFile {
			err = s.sendMedia(ctx, jid, att, request.Text)
		} else {
			err = s.sendText(ctx, jid, request.Text)
		}
		if err != nil {
			writeCode(w, "send_failed")
			return
		}
		writeJSON(w, http.StatusOK, sendResult{Kind: att.Kind, Name: att.Name})
	})
	return mux
}
