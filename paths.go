package main

import (
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"unicode"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Reject relative/drive-relative paths and Win32 device/extended namespaces.
func absoluteLocalPath(raw string) (string, error) {
	if raw == "" || strings.IndexFunc(raw, unicode.IsControl) >= 0 || strings.ContainsAny(raw, `"<>|?*`) {
		return "", errors.New("invalid path characters")
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

func existingPath(raw, language string) (string, os.FileInfo, error) {
	clean, err := absoluteLocalPath(raw)
	if err != nil {
		return "", nil, localizedError(language, "Ungueltiger absoluter Pfad", err)
	}
	info, err := os.Stat(clean)
	if err == nil && !info.IsDir() && !info.Mode().IsRegular() {
		err = errors.New("regular file or directory required")
	}
	return clean, info, localizedError(language, "Pfad konnte nicht geoeffnet werden", err)
}

func validatedExternalURL(raw string) (string, error) {
	if raw == "" || strings.IndexFunc(raw, func(r rune) bool { return unicode.IsSpace(r) || unicode.IsControl(r) }) >= 0 || strings.Contains(raw, `\`) {
		return "", errors.New("invalid URL characters")
	}
	u, err := url.Parse(raw)
	if err != nil {
		return "", err
	}
	if (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.Hostname() == "" || u.User != nil || u.Opaque != "" {
		return "", errors.New("absolute HTTP(S) URL without credentials required")
	}
	return u.String(), nil
}

func (a *App) OpenExternalURL(rawURL string) error {
	a.mu.Lock()
	ctx, language := a.ctx, a.settings.UILanguage
	a.mu.Unlock()
	target, err := validatedExternalURL(rawURL)
	if err != nil {
		return localizedError(language, "Ungueltige HTTP(S)-URL", err)
	}
	if ctx == nil {
		return errors.New(backendText(language, "Browser konnte nicht geoeffnet werden"))
	}
	runtime.BrowserOpenURL(ctx, target)
	return nil
}
