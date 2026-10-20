//go:build !windows

package main

import (
	"os"
	"syscall"
)

// privateFiles makes every file and folder the bridge creates owner-only.
func privateFiles() { syscall.Umask(0o077) }

// openNoFollow opens name, refusing a link in its last part.
func openNoFollow(name string, flag int, perm os.FileMode) (*os.File, error) {
	return os.OpenFile(name, flag|syscall.O_NOFOLLOW, perm)
}

// hardLinked reports whether the open file has more than one name.
func hardLinked(_ *os.File, info os.FileInfo) bool {
	st, ok := info.Sys().(*syscall.Stat_t)
	return ok && st.Nlink > 1
}
