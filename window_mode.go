package main

// WindowMode is runtime state, independent of content view and persisted settings.
type WindowMode string

const (
	WindowModeTaskbar WindowMode = "taskbar"
	WindowModeMini    WindowMode = "mini"
	WindowModeWindow  WindowMode = "window"
)
