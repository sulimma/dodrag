//go:build windows

package main

import (
	"context"
	"crypto/sha256"
	"errors"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"syscall"
	"unsafe"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/sys/windows"
)

const (
	setupActionInstall           = "install"
	setupActionDesktopShortcut   = "desktop-shortcut"
	setupActionStartMenuShortcut = "startmenu-shortcut"
)

var iidIPersistFile = comGUID{0x0000010b, 0x0000, 0x0000, [8]byte{0xc0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46}}

// installTargetPath is the per-user install location. Roaming %APPDATA% is for
// synchronized user data; executables belong in the non-roaming local profile.
func installTargetPath() (string, error) {
	local, err := windows.KnownFolderPath(windows.FOLDERID_LocalAppData, 0)
	if err != nil || strings.TrimSpace(local) == "" {
		return "", err
	}
	return filepath.Join(local, "Programs", "DoDrag", "DoDrag.exe"), nil
}

func desktopShortcutPath() (string, error) {
	desktop, err := windows.KnownFolderPath(windows.FOLDERID_Desktop, 0)
	if err != nil || strings.TrimSpace(desktop) == "" {
		return "", err
	}
	return filepath.Join(desktop, "DoDrag.lnk"), nil
}

func startMenuShortcutPath() (string, error) {
	programs, err := windows.KnownFolderPath(windows.FOLDERID_Programs, 0)
	if err != nil || strings.TrimSpace(programs) == "" {
		return "", err
	}
	return filepath.Join(programs, "DoDrag.lnk"), nil
}

func computeSetupState() SetupState {
	current, _ := os.Executable()
	state := SetupState{CurrentExe: filepath.Clean(current)}
	if state.CurrentExe != "" && state.CurrentExe != "." {
		state.CurrentDir = filepath.Dir(state.CurrentExe)
	}
	if target, err := installTargetPath(); err == nil {
		state.InstallPath = target
		state.ProgramInstalled, state.InstalledVersionOlder = programSetupState(state.CurrentExe, target, readExecutableVersion)
	}
	if path, err := desktopShortcutPath(); err == nil {
		_, err := os.Stat(path)
		state.DesktopShortcut = err == nil
	}
	if path, err := startMenuShortcutPath(); err == nil {
		_, err := os.Stat(path)
		state.StartMenuShortcut = err == nil
	}
	return state
}

type executableVersion [3]uint16

func programSetupState(current, target string, readVersion func(string) (executableVersion, bool)) (installed, older bool) {
	if info, err := os.Stat(target); err != nil || info.IsDir() {
		return false, false
	}
	if strings.EqualFold(current, target) {
		return true, false
	}
	currentVersion, currentOK := readVersion(current)
	targetVersion, targetOK := readVersion(target)
	if currentOK && targetOK && slices.Compare(targetVersion[:], currentVersion[:]) < 0 {
		return false, true
	}
	// Other builds can still be copied manually, even when the version matches.
	return filesIdentical(current, target), false
}

func readExecutableVersion(path string) (executableVersion, bool) {
	var unused windows.Handle
	size, err := windows.GetFileVersionInfoSize(path, &unused)
	if err != nil || size == 0 {
		return executableVersion{}, false
	}
	buffer := make([]byte, size)
	if err := windows.GetFileVersionInfo(path, 0, size, unsafe.Pointer(&buffer[0])); err != nil {
		return executableVersion{}, false
	}
	var info *windows.VS_FIXEDFILEINFO
	var infoSize uint32
	const fixedVersionSignature = 0xFEEF04BD
	err = windows.VerQueryValue(unsafe.Pointer(&buffer[0]), `\`, unsafe.Pointer(&info), &infoSize)
	if err != nil || info == nil || uintptr(infoSize) < unsafe.Sizeof(*info) || info.Signature != fixedVersionSignature {
		return executableVersion{}, false
	}
	// Packaging stores the three numeric version components, without the rc suffix.
	return executableVersion{uint16(info.FileVersionMS >> 16), uint16(info.FileVersionMS), uint16(info.FileVersionLS >> 16)}, true
}

// filesIdentical reports whether both paths contain the same bytes. Sizes are
// checked first so differing versions usually avoid hashing.
func filesIdentical(left, right string) bool {
	leftInfo, err := os.Stat(left)
	if err != nil {
		return false
	}
	rightInfo, err := os.Stat(right)
	if err != nil || leftInfo.Size() != rightInfo.Size() {
		return false
	}
	hash := func(name string) ([sha256.Size]byte, error) {
		file, err := os.Open(name)
		if err != nil {
			return [sha256.Size]byte{}, err
		}
		defer file.Close()
		digest := sha256.New()
		if _, err := io.Copy(digest, file); err != nil {
			return [sha256.Size]byte{}, err
		}
		var sum [sha256.Size]byte
		copy(sum[:], digest.Sum(nil))
		return sum, nil
	}
	leftSum, err := hash(left)
	if err != nil {
		return false
	}
	rightSum, err := hash(right)
	return err == nil && leftSum == rightSum
}

// installProgram copies the running executable into the per-user install folder.
// The running process keeps using its own file; the next start uses the copy.
func installProgram(ctx context.Context, language string) (bool, error) {
	source, err := os.Executable()
	if err != nil {
		return false, localizedError(language, "Programm-Pfad konnte nicht ermittelt werden", err)
	}
	source = filepath.Clean(source)
	target, err := installTargetPath()
	if err != nil {
		return false, localizedError(language, "Benutzerordner konnte nicht ermittelt werden", err)
	}
	if strings.EqualFold(source, target) {
		return false, nil
	}
	if info, statErr := os.Stat(target); statErr == nil && !info.IsDir() {
		confirmed, confirmErr := confirmOverwrite(ctx, language)
		if confirmErr != nil {
			return false, confirmErr
		}
		if !confirmed {
			return false, nil
		}
	}
	if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
		return false, localizedError(language, "Benutzerordner konnte nicht ermittelt werden", err)
	}
	temp := target + ".tmp"
	_ = os.Remove(temp)
	if err := copyFile(source, temp); err != nil {
		_ = os.Remove(temp)
		return false, localizedError(language, "Programm konnte nicht kopiert werden", err)
	}
	if err := os.Rename(temp, target); err != nil {
		_ = os.Remove(temp)
		return false, localizedError(language, "Programm konnte nicht kopiert werden", err)
	}

	// Existing shortcuts and a possible overwrite must point at the target.
	var shortcutErrors []error
	for _, resolve := range []func() (string, error){desktopShortcutPath, startMenuShortcutPath} {
		if path, pathErr := resolve(); pathErr == nil {
			if _, statErr := os.Stat(path); statErr == nil {
				if err := createShortcut(path, target, language); err != nil {
					shortcutErrors = append(shortcutErrors, err)
				}
			}
		}
	}
	return true, errors.Join(shortcutErrors...)
}

func confirmOverwrite(ctx context.Context, language string) (bool, error) {
	if ctx == nil {
		return true, nil
	}
	return confirmOverwriteDialog(ctx, language, wailsRuntime.MessageDialog)
}

// Wails' Windows MessageBox uses OS-localized buttons but returns fixed English
// response IDs. Buttons/DefaultButton/CancelButton must not use app translations.
func confirmOverwriteDialog(ctx context.Context, language string, dialog func(context.Context, wailsRuntime.MessageDialogOptions) (string, error)) (bool, error) {
	choice, err := dialog(ctx, wailsRuntime.MessageDialogOptions{
		Type:          wailsRuntime.QuestionDialog,
		Title:         backendText(language, "Vorhandene Version überschreiben?"),
		Message:       backendText(language, "Am Zielort ist bereits eine DoDrag-Version vorhanden. Soll sie überschrieben werden?"),
		Buttons:       []string{"Yes", "No"},
		DefaultButton: "Yes",
		CancelButton:  "No",
	})
	if err != nil {
		return false, localizedError(language, "Überschreiben konnte nicht bestätigt werden", err)
	}
	return choice == "Yes", nil
}

// installedExecutable returns the install target if it exists, so shortcuts and
// autostart always use the installed copy.
func installedExecutable() (string, error) {
	if target, err := installTargetPath(); err == nil {
		if info, statErr := os.Stat(target); statErr == nil && !info.IsDir() {
			return target, nil
		}
	}
	return os.Executable()
}

func copyFile(source, target string) error {
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0755)
	if err != nil {
		return err
	}
	if _, err = io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	if err = out.Sync(); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

// createShortcut writes a .lnk via IShellLink + IPersistFile. COM must be
// initialized on the calling OS thread, so both are locked for this call.
func createShortcut(path, target, language string) error {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	hr, _, _ := procCoInitializeEx.Call(0, 0x2) // COINIT_APARTMENTTHREADED
	// RPC_E_CHANGED_MODE means the thread already uses another apartment model;
	// ShellLink and IPersistFile still work, so do not fail or uninitialize it.
	alreadyInitialized := uint32(hr) == 0x80010106
	if int32(hr) < 0 && !alreadyInitialized {
		return localizedError(language, "Verknüpfung konnte nicht erstellt werden", errors.New("CoInitializeEx"))
	}
	if !alreadyInitialized {
		defer procCoUninitialize.Call()
	}

	link := createJumpListShellLink(target, "", "DoDrag", "")
	if link == 0 {
		return localizedError(language, "Verknüpfung konnte nicht erstellt werden", errors.New("IShellLink"))
	}
	defer comRelease(link)

	var persist uintptr
	hr, _, _ = syscall.SyscallN(
		comVtableMethod(link, 0),
		link,
		uintptr(unsafe.Pointer(&iidIPersistFile)),
		uintptr(unsafe.Pointer(&persist)),
	)
	if int32(hr) < 0 || persist == 0 {
		return localizedError(language, "Verknüpfung konnte nicht erstellt werden", errors.New("IPersistFile"))
	}
	defer comRelease(persist)

	pathPtr, _ := syscall.UTF16PtrFromString(path)
	hr, _, _ = syscall.SyscallN(comVtableMethod(persist, 6), persist, uintptr(unsafe.Pointer(pathPtr)), 1)
	runtime.KeepAlive(pathPtr)
	if int32(hr) < 0 {
		return localizedError(language, "Verknüpfung konnte nicht erstellt werden", errors.New("IPersistFile.Save"))
	}
	return nil
}
