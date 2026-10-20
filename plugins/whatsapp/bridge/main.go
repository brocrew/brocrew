package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

// config arrives as one JSON line on stdin, so the token never appears in the environment or argv.
type config struct {
	DataDir      string `json:"dataDir"`
	FilesDir     string `json:"filesDir"`
	DownloadsDir string `json:"downloadsDir"`
	ScratchDir   string `json:"scratchDir"`
	Token        string `json:"token"`
}

func readConfig(stdin *bufio.Reader) (config, error) {
	line, err := stdin.ReadString('\n')
	if err != nil {
		return config{}, err
	}
	var c config
	decoder := json.NewDecoder(strings.NewReader(line))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&c); err != nil {
		return config{}, err
	}
	for _, dir := range []string{c.DataDir, c.FilesDir, c.DownloadsDir, c.ScratchDir} {
		if !filepath.IsAbs(dir) || filepath.Clean(dir) != dir {
			return config{}, errors.New("config")
		}
	}
	if len(c.Token) < 32 || len(c.Token) > 4096 {
		return config{}, errors.New("config")
	}
	return c, nil
}

// exitUnlinked tells the Node server this device is no longer linked, so it deletes the data folder before the next start.
const exitUnlinked = 3

func fail(word string) {
	fmt.Fprintln(os.Stderr, "whatsapp-bridge: "+word)
	os.Exit(1)
}

func main() {
	privateFiles()
	stdin := bufio.NewReaderSize(os.Stdin, 8192)
	cfg, err := readConfig(stdin)
	if err != nil {
		fail("config")
	}
	for _, dir := range []string{cfg.DataDir, cfg.ScratchDir} {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			fail("data")
		}
	}
	cleanScratch(cfg.ScratchDir)
	stop := make(chan struct{}, 1)
	unlinked := func() {
		select {
		case stop <- struct{}{}:
		default:
		}
	}
	session, err := openSession(cfg, unlinked)
	if err != nil {
		fail("session")
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		fail("listen")
	}
	server := &http.Server{
		Handler:           newAPI(cfg, session, unlinked),
		ReadHeaderTimeout: 5 * time.Second,
	}
	go func() {
		if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			fail("serve")
		}
	}()
	if err := json.NewEncoder(os.Stdout).Encode(map[string]int{"listening": listener.Addr().(*net.TCPAddr).Port}); err != nil {
		fail("announce")
	}
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		// The Node server owns this process: when it goes, stdin closes and the bridge follows.
		_, _ = stdin.ReadString('\n')
		signals <- syscall.SIGTERM
	}()
	code := 0
	select {
	case <-signals:
	case <-stop:
		code = exitUnlinked
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	_ = server.Shutdown(ctx)
	cancel()
	session.close()
	os.Exit(code)
}
