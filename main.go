package main

import (
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/logger"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

// Wails sizes are logical outer-window dimensions on Windows.
const (
	defaultWindowWidth  = 1440
	defaultWindowHeight = 820
	minimumWindowWidth  = 860
	minimumWindowHeight = 560
)

func main() {
	closeDiagnostics := startDiagnostics()
	defer closeDiagnostics()
	app := NewApp()

	err := wails.Run(&options.App{
		Logger:             diagnosticLogger{},
		LogLevel:           logger.WARNING,
		LogLevelProduction: logger.WARNING,
		// The client titlebar owns compact/minimize/maximize/close together.
		// Wails' default frameless decorations keep native resize borders and
		// DWM shadow; its WM_NCCALCSIZE handling hides only the OS caption.
		Frameless: true,
		Title:     "DoDrag",
		Width:     defaultWindowWidth,
		Height:    defaultWindowHeight,
		MinWidth:  minimumWindowWidth,
		MinHeight: minimumWindowHeight,
		AssetServer: &assetserver.Options{
			Assets:     assets,
			Middleware: app.previewAssetMiddleware,
		},
		DragAndDrop: &options.DragAndDrop{
			EnableFileDrop:     true,
			DisableWebViewDrop: false,
			CSSDropProperty:    "--wails-drop-target",
			CSSDropValue:       "drop",
		},
		BackgroundColour: &options.RGBA{R: 248, G: 250, B: 252, A: 1},
		OnStartup:        app.startup,
		OnShutdown:       app.shutdown,
		OnBeforeClose:    app.beforeClose,
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId:               "dodrag-single-instance-v1",
			OnSecondInstanceLaunch: app.onSecondInstanceLaunch,
		},
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		diagnosticLogger{}.Error(err.Error())
	}
}
