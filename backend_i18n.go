package main

import (
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"strings"
)

// These catalogs are independent of the frontend bundle and its locale loader.
//
//go:embed frontend/src/i18n/locales/backend-*.json
var backendLocaleFiles embed.FS

var uiLanguages = []string{"de", "en", "fr", "es", "zh-CN", "uk", "pt-BR", "ja", "zh-TW", "ko", "it", "pl", "tr"}

var backendCatalogs = loadBackendCatalogs(backendLocaleFiles)

func validUILanguage(language string) bool {
	for _, supported := range uiLanguages {
		if language == supported {
			return true
		}
	}
	return false
}

func loadBackendCatalogs(files fs.FS) map[string]map[string]string {
	catalogs := make(map[string]map[string]string)
	for _, language := range uiLanguages {
		raw, err := fs.ReadFile(files, "frontend/src/i18n/locales/backend-"+language+".json")
		if err != nil {
			continue
		}
		var catalog map[string]string
		if err := json.Unmarshal(raw, &catalog); err != nil {
			panic(fmt.Sprintf("invalid backend catalog %s: %v", language, err))
		}
		catalogs[language] = catalog
	}
	return catalogs
}

func backendText(language, key string, replacements ...string) string {
	if !validUILanguage(language) {
		language = "en"
	}
	text := ""
	for _, candidate := range []string{language, "en", "de"} {
		if text = backendCatalogs[candidate][key]; text != "" {
			break
		}
	}
	if text == "" {
		text = key
	}
	for i := 0; i+1 < len(replacements); i += 2 {
		text = strings.ReplaceAll(text, "{"+replacements[i]+"}", replacements[i+1])
	}
	return text
}

// textLocked is used while a.mu is held. Dialogs obtain a language snapshot instead.
func (a *App) textLocked(key string, replacements ...string) string {
	return backendText(a.settings.UILanguage, key, replacements...)
}

func (a *App) currentUILanguage() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.settings.UILanguage
}

func localizedError(language, key string, err error, replacements ...string) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("%s: %w", backendText(language, key, replacements...), err)
}

func (a *App) errorLocked(key string, err error, replacements ...string) error {
	return localizedError(a.settings.UILanguage, key, err, replacements...)
}

// Serialize native registrations and read the latest setting, not a stale queued language.
func (a *App) refreshJumpList() {
	a.jumpListMu.Lock()
	defer a.jumpListMu.Unlock()
	language := a.currentUILanguage()
	if a.registerJumpList != nil {
		a.registerJumpList(language)
	} else {
		registerTaskbarJumpList(language)
	}
}
