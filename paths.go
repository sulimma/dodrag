package main

import (
	"errors"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Stored names retain their spelling. Missing entries can only match their own path.
func sameFilePath(left, right string) bool {
	if left == "" || right == "" {
		return false
	}
	if left == right {
		return true
	}
	first, err := os.Stat(left)
	if err != nil {
		return false
	}
	second, err := os.Stat(right)
	return err == nil && os.SameFile(first, second)
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

// ReadMarkdownFile imports source text, never HTML. Bound reads and validate UTF-8
// before returning anything so a failed drop cannot replace or partially append data.
func (a *App) ReadMarkdownFile(raw string) (string, error) {
	a.mu.Lock()
	language := a.settings.UILanguage
	a.mu.Unlock()
	path, info, err := existingPath(raw, language)
	if err != nil {
		return "", err
	}
	if info.IsDir() || !strings.EqualFold(filepath.Ext(path), ".md") {
		return "", localizedError(language, "Pfad konnte nicht geoeffnet werden", errors.New("Markdown .md file required"))
	}
	file, err := os.Open(path)
	if err != nil {
		return "", localizedError(language, "Pfad konnte nicht geoeffnet werden", err)
	}
	defer file.Close()
	const limit = 16 * 1024 * 1024
	data, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err == nil && (len(data) > limit || !utf8.Valid(data)) {
		err = errors.New("Markdown must be UTF-8 and at most 16 MiB")
	}
	if err != nil {
		return "", localizedError(language, "Pfad konnte nicht geoeffnet werden", err)
	}
	return strings.TrimPrefix(string(data), "\ufeff"), nil
}
