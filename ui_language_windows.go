//go:build windows

package main

import "golang.org/x/sys/windows"

var procGetUserDefaultUILanguage = windows.NewLazySystemDLL("kernel32.dll").NewProc("GetUserDefaultUILanguage")

func getUserDefaultUILanguage() uint16 {
	if err := procGetUserDefaultUILanguage.Find(); err != nil {
		return 0
	}
	language, _, _ := procGetUserDefaultUILanguage.Call()
	return uint16(language)
}

// LANGID is a primary language (10 bits) plus a sublanguage (6 bits).
func uiLanguageFromWindows(language uint16) string {
	switch language & 0x03ff {
	case 0x07:
		return "de"
	case 0x09:
		return "en"
	case 0x0c:
		return "fr"
	case 0x0a:
		return "es"
	case 0x04:
		switch language >> 10 {
		case 1, 3, 5, 31:
			return "zh-TW"
		default:
			return "zh-CN"
		}
	case 0x22:
		return "uk"
	case 0x16:
		return "pt-BR"
	case 0x11:
		return "ja"
	case 0x12:
		return "ko"
	case 0x10:
		return "it"
	case 0x15:
		return "pl"
	case 0x1f:
		return "tr"
	default:
		return "en"
	}
}

func (a *App) initialUILanguage() string {
	if a.userDefaultUILanguage != nil {
		return uiLanguageFromWindows(a.userDefaultUILanguage())
	}
	return uiLanguageFromWindows(getUserDefaultUILanguage())
}
