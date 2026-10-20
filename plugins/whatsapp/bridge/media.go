package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"image"
	"image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"go.mau.fi/whatsmeow"
	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

const (
	mediaMaxBytes  = 25 << 20
	mediaWireLimit = mediaMaxBytes + 1<<20
	previewSide    = 1600
	previewBytes   = 1 << 20
)

var (
	mediaMessageID = regexp.MustCompile(`^[0-9A-Za-z_-]{5,64}$`)
	mediaOutName   = regexp.MustCompile(`^[0-9a-f]{16}_[0-9A-Za-z_-]{5,64}\.(?:jpg|png|webp|pdf)$`)
	errNoMedia     = errors.New("no media")
)

// MediaDownloader implements whatsmeow.DownloadableMessage for a stored message row.
type MediaDownloader struct {
	URL           string
	DirectPath    string
	MediaKey      []byte
	FileLength    uint64
	FileSHA256    []byte
	FileEncSHA256 []byte
	MediaType     whatsmeow.MediaType
}

func (d *MediaDownloader) GetDirectPath() string             { return d.DirectPath }
func (d *MediaDownloader) GetURL() string                    { return d.URL }
func (d *MediaDownloader) GetMediaKey() []byte               { return d.MediaKey }
func (d *MediaDownloader) GetFileLength() uint64             { return d.FileLength }
func (d *MediaDownloader) GetFileSHA256() []byte             { return d.FileSHA256 }
func (d *MediaDownloader) GetFileEncSHA256() []byte          { return d.FileEncSHA256 }
func (d *MediaDownloader) GetMediaType() whatsmeow.MediaType { return d.MediaType }

// mediaDirectPath is the path AND query of the stored media URL; without the query the CDN refuses the download.
func mediaDirectPath(rawURL string) string {
	parts := strings.SplitN(rawURL, ".net/", 2)
	if len(parts) < 2 || parts[1] == "" {
		return rawURL
	}
	return "/" + parts[1]
}

// whatsmeow reads a media response whole, so every response goes through this transport: a declared length over the limit is
// refused unread, and the body can never deliver more than the limit.
var errMediaTooLarge = errors.New("media response larger than the limit")

type limitedBody struct {
	body      io.ReadCloser
	remaining int64
}

func (b *limitedBody) Read(p []byte) (int, error) {
	if b.remaining <= 0 {
		var probe [1]byte
		n, err := b.body.Read(probe[:])
		if n > 0 {
			return 0, errMediaTooLarge
		}
		return 0, err
	}
	if int64(len(p)) > b.remaining {
		p = p[:b.remaining]
	}
	n, err := b.body.Read(p)
	b.remaining -= int64(n)
	return n, err
}

func (b *limitedBody) Close() error { return b.body.Close() }

type limitedTransport struct {
	base  http.RoundTripper
	limit int64
}

func (t limitedTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	resp, err := t.base.RoundTrip(r)
	if err != nil {
		return nil, err
	}
	if resp.ContentLength > t.limit {
		_ = resp.Body.Close()
		return nil, errMediaTooLarge
	}
	resp.Body = &limitedBody{body: resp.Body, remaining: t.limit}
	return resp, nil
}

func boundedMediaClient() *http.Client {
	return &http.Client{Transport: limitedTransport{base: http.DefaultTransport.(*http.Transport).Clone(), limit: mediaWireLimit}}
}

type mediaRequest struct {
	ID   string `json:"id"`
	Chat string `json:"chat"`
	Out  string `json:"out"`
}

type mediaResult struct {
	Kind    string `json:"kind"`
	Mime    string `json:"mime"`
	Size    int    `json:"size"`
	Path    string `json:"path"`
	Preview string `json:"preview,omitempty"`
}

// mediaKind is what these bytes are, read from the bytes: a photo (JPEG, PNG, WebP) or a PDF. Anything else is refused.
func mediaKind(data []byte) (kind, mime, ext string) {
	switch {
	case bytes.HasPrefix(data, []byte{0xff, 0xd8, 0xff}):
		return "image", "image/jpeg", "jpg"
	case bytes.HasPrefix(data, []byte("\x89PNG\r\n\x1a\n")):
		return "image", "image/png", "png"
	case len(data) >= 12 && string(data[:4]) == "RIFF" && string(data[8:12]) == "WEBP":
		return "image", "image/webp", "webp"
	case bytes.HasPrefix(data, []byte("%PDF-")):
		return "pdf", "application/pdf", "pdf"
	}
	return "", "", ""
}

// preview is the photo scaled to at most 1600 pixels a side as a JPEG of at most 1 MB; a re-encode keeps no metadata.
func preview(data []byte) string {
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return ""
	}
	bounds := img.Bounds()
	w, h := bounds.Dx(), bounds.Dy()
	if w <= 0 || h <= 0 || w > 20000 || h > 20000 {
		return ""
	}
	if w > previewSide || h > previewSide {
		if w >= h {
			h, w = h*previewSide/w, previewSide
		} else {
			w, h = w*previewSide/h, previewSide
		}
	}
	scaled := image.NewRGBA(image.Rect(0, 0, max(w, 1), max(h, 1)))
	draw.ApproxBiLinear.Scale(scaled, scaled.Bounds(), img, bounds, draw.Src, nil)
	for _, quality := range []int{82, 65, 45} {
		var out bytes.Buffer
		if jpeg.Encode(&out, scaled, &jpeg.Options{Quality: quality}) == nil && out.Len() <= previewBytes {
			return base64.StdEncoding.EncodeToString(out.Bytes())
		}
	}
	return ""
}

// downloadMedia fetches a stored message's photo or PDF and writes it, exclusively, under the plugin's downloads folder.
func (s *session) downloadMedia(ctx context.Context, request mediaRequest) (mediaResult, string) {
	if !mediaMessageID.MatchString(request.ID) || len(request.Chat) > 128 || filepath.Dir(request.Out) != s.cfg.DownloadsDir ||
		!mediaOutName.MatchString(filepath.Base(request.Out)) {
		return mediaResult{}, "invalid_request"
	}
	info, err := s.store.GetMediaInfo(request.ID, request.Chat)
	if errors.Is(err, errNoMessage) {
		return mediaResult{}, "not_found"
	}
	if err != nil || (info.MediaType != "image" && info.MediaType != "document") || info.URL == "" || len(info.MediaKey) == 0 {
		return mediaResult{}, "no_media"
	}
	if info.FileLength == 0 || info.FileLength > mediaMaxBytes {
		return mediaResult{}, "too_large"
	}
	client := s.currentClient()
	if client == nil || !s.linked() {
		return mediaResult{}, "not_connected"
	}
	kind := whatsmeow.MediaImage
	if info.MediaType == "document" {
		kind = whatsmeow.MediaDocument
	}
	data, err := client.Download(ctx, &MediaDownloader{
		URL: info.URL, DirectPath: mediaDirectPath(info.URL), MediaKey: info.MediaKey, FileLength: info.FileLength,
		FileSHA256: info.FileSHA256, FileEncSHA256: info.FileEncSHA256, MediaType: kind,
	})
	if err != nil || len(data) == 0 || len(data) > mediaMaxBytes {
		return mediaResult{}, "download_failed"
	}
	found, mime, ext := mediaKind(data)
	if found == "" {
		return mediaResult{}, "unsupported_media_type"
	}
	out := strings.TrimSuffix(request.Out, filepath.Ext(request.Out)) + "." + ext
	file, err := openNoFollow(out, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return mediaResult{}, "download_failed"
	}
	_, err = file.Write(data)
	if closeErr := file.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		_ = os.Remove(out)
		return mediaResult{}, "download_failed"
	}
	result := mediaResult{Kind: found, Mime: mime, Size: len(data), Path: out}
	if found == "image" {
		result.Preview = preview(data)
	}
	return result, ""
}
