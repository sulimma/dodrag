//go:build windows

package main

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"

	"golang.org/x/sys/windows"
)

// folderToOpen resolves the directory to open. Database entries pass their file
// path with isFile=true so Explorer always shows the containing folder.
func folderToOpen(path string, isFile bool, language string) (string, error) {
	clean := strings.TrimSpace(path)
	if clean != "" {
		clean = filepath.Clean(clean)
		if isFile {
			clean = filepath.Dir(clean)
		}
	}
	info, err := os.Stat(clean)
	if err != nil {
		return "", localizedError(language, "Ordner nicht gefunden: {path}", err, "path", clean)
	}
	if !info.IsDir() {
		return "", localizedError(language, "Ordner nicht gefunden: {path}", errors.New("not a directory"), "path", clean)
	}
	return clean, nil
}

// OpenFolderInExplorer opens the containing folder of a database file or the
// given folder itself in Windows Explorer.
func (a *App) OpenFolderInExplorer(path string, isFile bool) error {
	language := a.currentUILanguage()
	folder, err := folderToOpen(path, isFile, language)
	if err != nil {
		return err
	}
	// explorer.exe is a GUI process. HideWindow would open the window hidden,
	// so the start info must stay untouched.
	cmd := exec.Command("explorer.exe", folder)
	if err := cmd.Start(); err != nil {
		return localizedError(language, "Ordner konnte nicht geöffnet werden", err)
	}
	return cmd.Process.Release()
}

// OpenFolderInVSCode opens the containing folder of a database file or the
// given folder itself in a new Visual Studio Code window.
func (a *App) OpenFolderInVSCode(path string, isFile bool) error {
	language := a.currentUILanguage()
	folder, err := folderToOpen(path, isFile, language)
	if err != nil {
		return err
	}
	codePath, err := findVSCode()
	if err != nil {
		return errors.New(backendText(language, "Visual Studio Code wurde nicht gefunden"))
	}
	cmd := vscodeCommand(codePath, folder)
	if err := cmd.Start(); err != nil {
		return localizedError(language, "Visual Studio Code konnte nicht geöffnet werden", err)
	}
	return cmd.Process.Release()
}

// vscodeCommand never reuses an existing workspace: --new-window forces a fresh
// window instead of replacing or focusing an existing editor session.
func vscodeCommand(codePath, folder string) *exec.Cmd {
	args := []string{"--new-window", folder}
	if strings.EqualFold(filepath.Ext(codePath), ".cmd") || strings.EqualFold(filepath.Ext(codePath), ".bat") {
		cmd := exec.Command("cmd.exe", append([]string{"/d", "/c", "call", codePath}, args...)...)
		// Hide the console window of the command shim, not the editor itself.
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
		return cmd
	}
	return exec.Command(codePath, args...)
}

// findVSCode checks the usual per-user and machine-wide install locations before
// falling back to PATH.
func findVSCode() (string, error) {
	var candidates []string
	if base := os.Getenv("LOCALAPPDATA"); base != "" {
		candidates = append(candidates, filepath.Join(base, "Programs", "Microsoft VS Code", "Code.exe"))
	}
	for _, env := range []string{"ProgramFiles", "ProgramFiles(x86)"} {
		if base := os.Getenv(env); base != "" {
			candidates = append(candidates, filepath.Join(base, "Microsoft VS Code", "Code.exe"))
		}
	}
	for _, candidate := range candidates {
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate, nil
		}
	}
	if path, err := exec.LookPath("code.exe"); err == nil {
		return path, nil
	}
	if path, err := exec.LookPath("code.cmd"); err == nil {
		return path, nil
	}
	return "", windows.ERROR_FILE_NOT_FOUND
}
