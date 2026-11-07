package main

import (
	"fmt"
	"io"
	"os"
	"syscall"
)

const processQueryLimitedInformation = 0x1000

func birthOf(pid uint32) (ticks uint64, err error) {
	handle, err := syscall.OpenProcess(processQueryLimitedInformation, false, pid)
	if err != nil {
		return 0, fmt.Errorf("OpenProcess(%d): %w", pid, err)
	}
	defer func() {
		if closeErr := syscall.CloseHandle(handle); closeErr != nil {
			closeErr = fmt.Errorf("CloseHandle(%d): %w", pid, closeErr)
			if err == nil {
				ticks, err = 0, closeErr
			} else {
				err = fmt.Errorf("%w; %v", err, closeErr)
			}
		}
	}()
	var creation, exit, kernel, user syscall.Filetime
	if err := syscall.GetProcessTimes(handle, &creation, &exit, &kernel, &user); err != nil {
		return 0, fmt.Errorf("GetProcessTimes(%d): %w", pid, err)
	}
	return ticksFromFiletime(creation.HighDateTime, creation.LowDateTime)
}

func run(args []string, stdout, stderr io.Writer) int {
	if len(args) != 1 {
		fmt.Fprintln(stderr, "usage: chrome-process-birth.exe <positive-uint32-pid>")
		return 1
	}
	pid, err := parsePID(args[0])
	if err == nil {
		var ticks uint64
		ticks, err = birthOf(pid)
		if err == nil {
			_, err = fmt.Fprintf(stdout, "%d\n", ticks)
			if err != nil {
				err = fmt.Errorf("write stdout: %w", err)
			}
		}
	}
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	return 0
}

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}
