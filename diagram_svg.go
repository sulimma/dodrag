package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// SaveDiagramSVG exports a rendered preview to the file explicitly selected in
// the native save dialog. It does not access the task store.
func (a *App) SaveDiagramSVG(svg string) error {
	a.mu.Lock()
	ctx, language := a.ctx, a.settings.UILanguage
	a.mu.Unlock()
	const failure = "SVG konnte nicht gespeichert werden"
	if ctx == nil || !strings.HasPrefix(strings.TrimSpace(svg), "<svg") {
		return errors.New(backendText(language, failure))
	}
	path, err := runtime.SaveFileDialog(ctx, runtime.SaveDialogOptions{
		Title:           backendText(language, "SVG speichern"),
		DefaultFilename: "Diagram.svg",
		Filters:         []runtime.FileFilter{{DisplayName: "SVG (*.svg)", Pattern: "*.svg"}},
	})
	if err != nil {
		return localizedError(language, failure, err)
	}
	if path == "" {
		return nil
	}
	// The dialog checks overwrite consent for the selected name; never silently
	// switch to a different destination after that check.
	if !strings.EqualFold(filepath.Ext(path), ".svg") {
		return errors.New(backendText(language, "Dateiendung .svg erforderlich"))
	}
	if err := os.WriteFile(path, []byte(svg), 0o600); err != nil {
		return localizedError(language, failure, err)
	}
	return nil
}
