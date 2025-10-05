//go:build !embed

package app

import (
	"io/fs"
	"os"
)

// This file is only used when building without file embedding (default mode)
//
// DO NOT USE DIRECTLY, BUT INSTEAD INJECT "filesystem" from main.go
func GetFileSystem(workingDir string) fs.ReadFileFS {
	return os.DirFS(workingDir).(fs.ReadFileFS)
}
