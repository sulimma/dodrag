//go:build windows

package main

import (
	"fmt"
	"os"
	"path/filepath"

	"golang.org/x/sys/windows/registry"
)

const (
	runRegistryPath = `Software\Microsoft\Windows\CurrentVersion\Run`
	runValueName    = "DoDrag"
)

func syncWindowsAutostart(enabled bool) error {
	k, err := registry.OpenKey(registry.CURRENT_USER, runRegistryPath, registry.SET_VALUE|registry.QUERY_VALUE)
	if err != nil {
		return fmt.Errorf("Registry-Zugriff fehlgeschlagen: %w", err)
	}
	defer k.Close()

	if !enabled {
		err := k.DeleteValue(runValueName)
		if err != nil && err != registry.ErrNotExist {
			return fmt.Errorf("Autostart konnte nicht entfernt werden: %w", err)
		}
		return nil
	}

	exePath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("Programm-Pfad konnte nicht ermittelt werden: %w", err)
	}
	exePath = filepath.Clean(exePath)

	cmd := fmt.Sprintf(`"%s" --minimized`, exePath)
	if err := k.SetStringValue(runValueName, cmd); err != nil {
		return fmt.Errorf("Autostart konnte nicht gesetzt werden: %w", err)
	}
	return nil
}
