package main

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
)

func folderToOpen(raw string, isFile bool, language string) (string, error) {
	folder, err := absoluteLocalPath(raw)
	if err == nil {
		if isFile {
			// A known database can be missing while its containing folder exists.
			folder = filepath.Dir(folder)
		}
		var info os.FileInfo
		info, err = os.Stat(folder)
		if err == nil && !info.IsDir() {
			err = errors.New("not a directory")
		}
	} else {
		folder = raw
	}
	return folder, localizedError(language, "Ordner nicht gefunden: {path}", err, "path", folder)
}

// These bridge names are shared with Windows. xdg-open is only given a verified
// directory; Linux file managers have no portable select-file operation.
func (a *App) OpenFolderInExplorer(raw string, isFile bool) error {
	language := a.currentUILanguage()
	folder, err := folderToOpen(raw, isFile, language)
	if err != nil {
		return err
	}
	return localizedError(language, "Ordner konnte nicht geöffnet werden", startLocalPathCommand("xdg-open", folder))
}

func (a *App) OpenPathInExplorer(raw string) error {
	language := a.currentUILanguage()
	path, info, err := existingPath(raw, language)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		path = filepath.Dir(path)
	}
	return localizedError(language, "Pfad konnte nicht geoeffnet werden", startLocalPathCommand("xdg-open", path))
}

func (a *App) OpenFolderInVSCode(raw string, isFile bool) error {
	language := a.currentUILanguage()
	folder, err := folderToOpen(raw, isFile, language)
	if err != nil {
		return err
	}
	return openPathInLinuxVSCode(folder, language)
}

func (a *App) OpenPathInVSCode(raw string) error {
	language := a.currentUILanguage()
	path, _, err := existingPath(raw, language)
	if err != nil {
		return err
	}
	return openPathInLinuxVSCode(path, language)
}

func openPathInLinuxVSCode(path, language string) error {
	code, err := exec.LookPath("code")
	if err != nil {
		return errors.New(backendText(language, "Visual Studio Code wurde nicht gefunden"))
	}
	return localizedError(language, "Pfad konnte nicht geoeffnet werden", startLocalPathCommand(code, "--new-window", path))
}

func startLocalPathCommand(program string, args ...string) error {
	// Pass every filename as a literal argument, never through a shell. Reap
	// the process without waiting for the external application to close.
	cmd := exec.Command(program, args...)
	if err := cmd.Start(); err != nil {
		return err
	}
	go func() { _ = cmd.Wait() }()
	return nil
}
