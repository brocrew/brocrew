package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"strings"
	"testing"

	"go.mau.fi/whatsmeow"
)

func TestLongTextKeepsProtocolValidation(t *testing.T) {
	if !validText(strings.Repeat("x", 4101), true) || !validText(strings.Repeat("c", 1003), false) {
		t.Fatal("long text and captions should reach the provider")
	}
	for _, text := range []string{"", " ", "hello\x00", string([]byte{0xff})} {
		if validText(text, true) {
			t.Fatalf("invalid required text accepted: %q", text)
		}
	}
}

func TestSendErrorDetails(t *testing.T) {
	server := fmt.Errorf("%w %d", whatsmeow.ErrServerReturnedError, 413)
	for _, tc := range []struct {
		name string
		err  error
		want map[string]any
	}{
		{"server", server, map[string]any{"error": "send_failed", "detail": "server returned error 413"}},
		{"caption", &captionSendError{cause: server}, map[string]any{"error": "caption_failed", "audioSent": true, "captionSent": false, "cause": "server returned error 413"}},
		{"media", &url.Error{Op: "Post", URL: "https://fictional.invalid/upload?auth=fictional-auth", Err: errors.New("offline")}, map[string]any{"error": "send_failed"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			writeSendResult(response, attachment{}, tc.err)
			var got map[string]any
			if err := json.Unmarshal(response.Body.Bytes(), &got); err != nil {
				t.Fatal(err)
			}
			if response.Code != http.StatusBadGateway || !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("send failure: status=%d body=%v want=%v", response.Code, got, tc.want)
			}
		})
	}
}
