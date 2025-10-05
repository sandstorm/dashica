//go:build embed

package app

import (
	"embed"
	"io/fs"
)

// EmbeddedFileSystem is the embedded src/content file system. This is helpful because we only need to deploy
// a single binary, AND it also is a security measure because it prevents directory traversal attacks outside
// the embedded directories.
//
// DO NOT USE DIRECTLY, BUT INSTEAD INJECT "filesystem" from main.go
//
//go:embed all:dist
var EmbeddedFileSystem embed.FS

func GetFileSystem(workingDir string) fs.ReadFileFS {
	var baseFs, _ = fs.Sub(EmbeddedFileSystem, "dist")
	return baseFs.(fs.ReadFileFS)
}
