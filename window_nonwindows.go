//go:build !windows

package main

func getForegroundWindowNative() uintptr {
	return 0
}
