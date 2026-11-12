package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"

	"go.mau.fi/whatsmeow"
)

func TestAttachmentWithoutLocalDigest(t *testing.T) {
	root := realDir(t)
	data := []byte("%PDF-1.7\nfictional attachment\n")
	file := fileRequest(t, filepath.Join(root, "notes.pdf"), data, "notes.pdf")
	att, code := openAttachment(root, sendFile{Path: file.Path, Name: file.Name, Size: file.Size})
	if code != "" {
		t.Fatalf("local file without a prior digest was refused: %s", code)
	}
	t.Cleanup(func() { att.File.Close() })
	if att.Size != int64(len(data)) || att.Mime != "application/pdf" {
		t.Fatalf("unexpected attachment metadata: %+v", att)
	}
}

type uploadFunc func(context.Context, io.Reader, io.ReadWriteSeeker, whatsmeow.MediaType) (whatsmeow.UploadResponse, error)

func (f uploadFunc) UploadReader(ctx context.Context, r io.Reader, tmp io.ReadWriteSeeker, kind whatsmeow.MediaType) (whatsmeow.UploadResponse, error) {
	return f(ctx, r, tmp, kind)
}

func TestUploadUsesCurrentProtocolDigest(t *testing.T) {
	root := realDir(t)
	data := []byte("current local attachment")
	name := filepath.Join(root, "notes.txt")
	if err := os.WriteFile(name, data, 0o600); err != nil {
		t.Fatal(err)
	}
	file, err := os.Open(name)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { file.Close() })
	att := attachment{File: file, Size: int64(len(data)), Kind: "document", Mime: "text/plain", Name: "notes.txt"}
	scratch := realDir(t)
	sum := sha256.Sum256(data)
	uploaded := whatsmeow.UploadResponse{FileLength: uint64(len(data)), FileSHA256: sum[:], FileEncSHA256: []byte("encrypted digest"), MediaKey: []byte("fictional media key")}
	uploader := uploadFunc(func(_ context.Context, r io.Reader, _ io.ReadWriteSeeker, kind whatsmeow.MediaType) (whatsmeow.UploadResponse, error) {
		got, err := io.ReadAll(r)
		if err != nil || !bytes.Equal(got, data) || kind != whatsmeow.MediaDocument {
			t.Fatalf("unexpected upload bytes/type: %q %v %v", got, kind, err)
		}
		return uploaded, nil
	})
	resp, err := uploadAttachment(context.Background(), uploader, att, scratch)
	if err != nil {
		t.Fatalf("current upload digest was refused: %v", err)
	}
	message := buildMediaMessages(att, "", resp)[0].GetDocumentMessage()
	if !bytes.Equal(message.GetFileSHA256(), sum[:]) || !bytes.Equal(message.GetFileEncSHA256(), uploaded.FileEncSHA256) || !bytes.Equal(message.GetMediaKey(), uploaded.MediaKey) {
		t.Fatal("actual provider protocol hashes or media key changed")
	}
	for _, fail := range []string{"provider", "length"} {
		t.Run(fail, func(t *testing.T) {
			providerError := errors.New("fictional upload failure")
			broken := uploadFunc(func(context.Context, io.Reader, io.ReadWriteSeeker, whatsmeow.MediaType) (whatsmeow.UploadResponse, error) {
				if fail == "provider" {
					return whatsmeow.UploadResponse{}, providerError
				}
				return whatsmeow.UploadResponse{FileLength: uint64(len(data) - 1), FileSHA256: sum[:]}, nil
			})
			_, err := uploadAttachment(context.Background(), broken, att, scratch)
			if err == nil || (fail == "provider" && !errors.Is(err, providerError)) {
				t.Fatalf("actual upload failure not preserved: %v", err)
			}
		})
	}
	files, err := os.ReadDir(scratch)
	if err != nil || len(files) != 0 {
		t.Fatalf("upload scratch files retained: %v %v", files, err)
	}
}
