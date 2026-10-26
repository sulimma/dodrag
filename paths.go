package main

import (
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
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

func (a *App) GetPathKind(raw string) (string, error) {
	a.mu.Lock()
	language := a.settings.UILanguage
	a.mu.Unlock()
	_, info, err := existingPath(raw, language)
	if err != nil {
		return "", err
	}
	if info.IsDir() {
		return "directory", nil
	}
	return "file", nil
}

var externalPhonePattern = regexp.MustCompile(`^\+?[0-9()_-]+$`)
var formattedExternalPhonePattern = regexp.MustCompile(`^\+?[0-9 ()_-]+$`)
var externalSIPPattern = regexp.MustCompile(`^[a-zA-Z0-9_.+:;=@%\[\]-]+$`)

func validatedExternalURL(raw string) (string, error) {
	if len(raw) >= 4 && strings.EqualFold(raw[:4], "tel:") && strings.Contains(raw[4:], " ") {
		if !formattedExternalPhonePattern.MatchString(raw[4:]) {
			return "", errors.New("invalid telephone URL")
		}
		raw = "tel:" + strings.NewReplacer(" ", "", "(", "", ")", "", "_", "", "-", "").Replace(raw[4:])
	}
	if raw == "" || strings.IndexFunc(raw, func(r rune) bool { return unicode.IsSpace(r) || unicode.IsControl(r) }) >= 0 || strings.ContainsAny(raw, `\<>"`) {
		return "", errors.New("invalid URL characters")
	}
	u, err := url.Parse(raw)
	if err != nil {
		return "", err
	}
	decoded, err := url.PathUnescape(raw)
	if err != nil || strings.IndexFunc(decoded, unicode.IsControl) >= 0 {
		return "", errors.New("invalid escaped URL characters")
	}
	switch u.Scheme {
	case "http", "https":
		if u.Host == "" || u.Hostname() == "" || u.User != nil || u.Opaque != "" {
			return "", errors.New("absolute HTTP(S) URL without credentials required")
		}
	case "mailto", "sip", "tel":
		if u.Opaque == "" || strings.HasPrefix(u.Opaque, "//") || u.Host != "" || u.User != nil || u.Fragment != "" {
			return "", errors.New("absolute communication URL required")
		}
		if u.Scheme == "tel" {
			digits := 0
			for _, r := range u.Opaque {
				if r >= '0' && r <= '9' {
					digits++
				}
			}
			if !externalPhonePattern.MatchString(u.Opaque) || digits == 0 || digits > 15 || u.RawQuery != "" {
				return "", errors.New("invalid telephone URL")
			}
		} else if u.Scheme == "mailto" {
			parts := strings.Split(u.Opaque, "@")
			if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
				return "", errors.New("invalid communication address")
			}
		} else if !externalSIPPattern.MatchString(u.Opaque) || u.RawQuery != "" {
			return "", errors.New("invalid SIP address")
		}
	default:
		return "", errors.New("unsupported URL scheme")
	}
	return u.String(), nil
}

func (a *App) OpenExternalURL(rawURL string) error {
	a.mu.Lock()
	ctx, language := a.ctx, a.settings.UILanguage
	a.mu.Unlock()
	target, err := validatedExternalURL(rawURL)
	if err != nil {
		return localizedError(language, "Ungueltige externe URL", err)
	}
	if ctx == nil {
		return errors.New(backendText(language, "Externe Anwendung konnte nicht geoeffnet werden"))
	}
	runtime.BrowserOpenURL(ctx, target)
	return nil
}
