//go:build windows

package main

import (
	"errors"
	"os"
	"syscall"
)

// privateFiles does nothing: Windows has no umask, and new files take the access list of the private folder they are in.
func privateFiles() {}

var errLinked = errors.New("the name is a link")

// openNoFollow opens name, refusing a link in its last part. Windows has no O_NOFOLLOW, so the name is checked before
// and after the open: a file to be new must not exist yet, not even as a link, and the name must then be the file opened.
func openNoFollow(name string, flag int, perm os.FileMode) (*os.File, error) {
	if flag&os.O_EXCL != 0 {
		if _, err := os.Lstat(name); err == nil {
			return nil, os.ErrExist
		}
	}
	file, err := os.OpenFile(name, flag, perm)
	if err != nil {
		return nil, err
	}
	opened, err := file.Stat()
	named, lerr := os.Lstat(name)
	if err != nil || lerr != nil || !named.Mode().IsRegular() || !os.SameFile(opened, named) {
		file.Close()
		return nil, errLinked
	}
	return file, nil
}

// hardLinked reports whether the open file has more than one name, or whether that cannot be read.
func hardLinked(file *os.File, _ os.FileInfo) bool {
	var info syscall.ByHandleFileInformation
	if syscall.GetFileInformationByHandle(syscall.Handle(file.Fd()), &info) != nil {
		return true
	}
	return info.NumberOfLinks > 1
}
