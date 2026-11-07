package main

import (
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"unsafe"
)

func TestBirthSelfAndCLI(t *testing.T) {
	pid := uint32(os.Getpid())
	want, err := birthOf(pid)
	if err != nil || want <= filetimeEpochTicks {
		t.Fatalf("self birth: %d, %v", want, err)
	}
	var stdout, stderr bytes.Buffer
	if code := run([]string{strconv.Itoa(os.Getpid())}, &stdout, &stderr); code != 0 || stderr.Len() != 0 || stdout.String() != strconv.FormatUint(want, 10)+"\n" {
		t.Fatalf("CLI: exit %d, stdout %q, stderr %q", code, stdout.String(), stderr.String())
	}
}

func TestBirthInvalidPID(t *testing.T) {
	for _, pid := range []uint32{0, 0xffffffff} {
		got, err := birthOf(pid)
		var errno syscall.Errno
		if got != 0 || !errors.As(err, &errno) || !strings.Contains(err.Error(), "OpenProcess(") {
			t.Fatalf("PID %d: got %d, %v; want concrete OpenProcess OS error", pid, got, err)
		}
	}
}

func TestCLIErrorsHaveNoIdentity(t *testing.T) {
	for _, args := range [][]string{nil, {"1", "2"}, {"0"}, {"-1"}, {"4294967296"}, {"4294967295"}} {
		var stdout, stderr bytes.Buffer
		if code := run(args, &stdout, &stderr); code == 0 || stdout.Len() != 0 || stderr.Len() == 0 {
			t.Fatalf("args %q: exit %d, stdout %q, stderr %q", args, code, stdout.String(), stderr.String())
		}
	}
}

// The child reports its own identity, then stays alive until its stdin closes.
func TestBirthChild(t *testing.T) {
	if os.Getenv("CHROME_BIRTH_TEST_CHILD") != "1" {
		return
	}
	ticks, err := birthOf(uint32(os.Getpid()))
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Printf("%d\n", ticks)
	if _, err := io.Copy(io.Discard, os.Stdin); err != nil {
		os.Exit(1)
	}
	os.Exit(0)
}

func TestBirthForeignAndExited(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	child := exec.Command(executable, "-test.run=^TestBirthChild$")
	child.Env = append(os.Environ(), "CHROME_BIRTH_TEST_CHILD=1")
	child.Stderr = os.Stderr
	stdin, err := child.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	defer stdin.Close()
	stdout, err := child.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := child.Start(); err != nil {
		t.Fatal(err)
	}
	waited := false
	defer func() {
		if !waited {
			child.Process.Kill()
			child.Wait()
		}
	}()
	line, err := bufio.NewReader(stdout).ReadString('\n')
	if err != nil {
		t.Fatal(err)
	}
	want, err := strconv.ParseUint(strings.TrimSuffix(line, "\n"), 10, 64)
	if err != nil || want <= filetimeEpochTicks {
		t.Fatalf("child identity %q: %v", line, err)
	}
	pid := uint32(child.Process.Pid)
	self, err := birthOf(uint32(os.Getpid()))
	if err != nil || self == want {
		t.Fatalf("foreign identity must differ from parent: self %d, child %d, error %v", self, want, err)
	}
	for range 3 {
		got, err := birthOf(pid)
		if err != nil || got != want {
			t.Fatalf("foreign PID %d: got %d, %v; child reported %d", pid, got, err, want)
		}
	}
	// Holding a process handle preserves its object after exit. GetProcessTimes
	// still returns its creation time; this API alone is not a liveness check.
	handle, err := syscall.OpenProcess(processQueryLimitedInformation, false, pid)
	if err != nil {
		t.Fatal(err)
	}
	defer syscall.CloseHandle(handle)
	if err := stdin.Close(); err != nil {
		t.Fatal(err)
	}
	err = child.Wait()
	waited = true
	if err != nil {
		t.Fatal(err)
	}
	if got, err := birthOf(pid); err != nil || got != want {
		t.Fatalf("retained exited PID %d: got %d, %v; want %d", pid, got, err, want)
	}
}

func TestBirthClosesHandles(t *testing.T) {
	getCount := syscall.NewLazyDLL("kernel32.dll").NewProc("GetProcessHandleCount")
	process, err := syscall.GetCurrentProcess()
	if err != nil {
		t.Fatal(err)
	}
	count := func() uint32 {
		t.Helper()
		var value uint32
		ok, _, err := getCount.Call(uintptr(process), uintptr(unsafe.Pointer(&value)))
		if ok == 0 {
			t.Fatalf("GetProcessHandleCount: %v", err)
		}
		return value
	}
	// Warm runtime initialization before measuring OS handles.
	if _, err := birthOf(uint32(os.Getpid())); err != nil {
		t.Fatal(err)
	}
	before := count()
	for range 128 {
		if _, err := birthOf(uint32(os.Getpid())); err != nil {
			t.Fatal(err)
		}
	}
	after := count()
	// Allow a few runtime handles, never one leaked handle per query.
	if after > before+8 {
		t.Fatalf("handle growth after 128 queries: before %d, after %d", before, after)
	}
}
