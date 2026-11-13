package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
)

func TestAudioCaptionSendOutcome(t *testing.T) {
	cause := errors.New("caption transport disconnected")
	for _, scenario := range []struct {
		name   string
		failAt int
		calls  int
	}{
		{"caption fails after audio", 2, 2},
		{"audio fails", 1, 1},
		{"both sent", 0, 2},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			messages := buildMediaMessages(attachment{Kind: "audio"}, "Meet at six", whatsmeow.UploadResponse{})
			calls := 0
			err := sendMediaMessages(messages, func(message *waE2E.Message) error {
				calls++
				if calls == 1 && message.GetAudioMessage() == nil {
					t.Fatal("audio was not sent first")
				}
				if calls == 2 && message.GetConversation() != "Meet at six" {
					t.Fatal("caption was not sent second")
				}
				if calls == scenario.failAt {
					return cause
				}
				return nil
			})
			if calls != scenario.calls {
				t.Fatalf("send calls: got %d, want %d", calls, scenario.calls)
			}
			if scenario.failAt == 0 {
				if err != nil {
					t.Fatal(err)
				}
			} else if !errors.Is(err, cause) {
				t.Fatalf("source send error lost: %v", err)
			}
			response := httptest.NewRecorder()
			writeSendResult(response, attachment{Kind: "audio", Name: "meeting.mp3"}, err)
			var body map[string]any
			if decodeErr := json.Unmarshal(response.Body.Bytes(), &body); decodeErr != nil {
				t.Fatal(decodeErr)
			}
			switch scenario.failAt {
			case 2:
				if !strings.Contains(err.Error(), "audio sent") {
					t.Fatalf("confirmed audio send lost: %v", err)
				}
				if response.Code != http.StatusBadGateway || body["error"] != "caption_failed" || body["audioSent"] != true || body["captionSent"] != false || body["cause"] != cause.Error() {
					t.Fatalf("partial outcome lost at HTTP: %d %s", response.Code, response.Body.String())
				}
			case 1:
				if response.Code != http.StatusBadGateway || body["error"] != "send_failed" || body["audioSent"] != nil {
					t.Fatalf("first failure claims audio sent: %d %s", response.Code, response.Body.String())
				}
			case 0:
				if response.Code != http.StatusOK || body["kind"] != "audio" || body["name"] != "meeting.mp3" {
					t.Fatalf("complete success changed: %d %s", response.Code, response.Body.String())
				}
			}
		})
	}
}
