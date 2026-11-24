package main

import (
	"errors"
	"path/filepath"
	"strings"
	"unicode"
)

// Reject relative/drive-relative paths and Win32 device/extended namespaces.
func absoluteLocalPath(raw string) (string, error) {
	if raw == "" || strings.IndexFunc(raw, unicode.IsControl) >= 0 || strings.ContainsAny(raw, `"<>|?*`) {
		return "", errors.New("invalid path characters")
	}
	// A single forward slash addresses the root of the current Windows volume.
	// Let Windows resolve it; never translate Unix mount points or drive names.
	if strings.HasPrefix(raw, "/") && !strings.HasPrefix(raw, "//") {
		var err error
		raw, err = filepath.Abs(raw)
		if err != nil {
			return "", err
		}
	}
	clean := filepath.Clean(raw)
	if !filepath.IsAbs(clean) || strings.HasPrefix(clean, `\\?\`) || strings.HasPrefix(clean, `\\.\`) {
		return "", errors.New("absolute filesystem path required")
	}
	// Alternate data streams must not bypass extension/content checks.
	if strings.Contains(strings.TrimPrefix(clean, filepath.VolumeName(clean)), ":") {
		return "", errors.New("alternate data streams are not supported")
	}
	return clean, nil
}

func validDatabaseFilename(trimmedName string) bool {
	return !(strings.ContainsAny(trimmedName, `<>:"/\|?*`) || trimmedName == "." || trimmedName == ".." || strings.HasSuffix(trimmedName, ".") || strings.HasSuffix(trimmedName, " "))
}
