//go:build !windows

package main

import "errors"

func (a *App) showTaskContextMenuNative(items []TaskMenuItem) (string, error) {
	return "", errors.New("native task context menus require Windows")
}

func (a *App) closeTaskContextMenusNative() {
	a.taskMenus.closed.Store(true)
}
