package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"unicode"
)

// Linux consumes native paths only. A colon, backslash or percent in an
// absolute path is a filename character, not a drive, separator or escape.
func absoluteLocalPath(raw string) (string, error) {
	if strings.IndexFunc(raw, unicode.IsControl) >= 0 {
		return "", errors.New("invalid path characters")
	}
	if !filepath.IsAbs(raw) {
		return "", errors.New("absolute filesystem path required")
	}
	return filepath.Clean(raw), nil
}

func validDatabaseFilename(name string) bool {
	return name != "" && name != "." && name != ".." && !strings.ContainsRune(name, '/') && strings.IndexFunc(name, unicode.IsControl) < 0
}

// Do not let a named pipe block preview/import before the open file can be
// checked. O_NONBLOCK has no effect on ordinary regular-file reads.
func openLocalFile(path string) (*os.File, error) {
	return os.OpenFile(path, os.O_RDONLY|syscall.O_NONBLOCK, 0)
}
