//go:build windows

package main

import (
	"fmt"
	"path/filepath"

	"golang.org/x/sys/windows/registry"
)

const (
	runRegistryPath = `Software\Microsoft\Windows\CurrentVersion\Run`
	runValueName    = "DoDrag"
)

func syncWindowsAutostart(enabled bool, language string) error {
	k, err := registry.OpenKey(registry.CURRENT_USER, runRegistryPath, registry.SET_VALUE|registry.QUERY_VALUE)
	if err != nil {
		return localizedError(language, "Registry-Zugriff fehlgeschlagen", err)
	}
	defer k.Close()

	if !enabled {
		err := k.DeleteValue(runValueName)
		if err != nil && err != registry.ErrNotExist {
			return localizedError(language, "Autostart konnte nicht entfernt werden", err)
		}
		return nil
	}

	exePath, err := installedExecutable()
	if err != nil {
		return localizedError(language, "Programm-Pfad konnte nicht ermittelt werden", err)
	}
	exePath = filepath.Clean(exePath)

	cmd := fmt.Sprintf(`"%s" --minimized`, exePath)
	if err := k.SetStringValue(runValueName, cmd); err != nil {
		return localizedError(language, "Autostart konnte nicht gesetzt werden", err)
	}
	return nil
}
