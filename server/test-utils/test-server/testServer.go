package test_server

import (
	"github.com/sandstorm/dashica/server/core"
	"io/fs"
	"os"
	"path/filepath"
	"testing"
)

func LoadTestingConfig(t *testing.T) (*core.AppConfig, fs.FS) {
	// ITERATE UP IN WORKING DIRECTORY UNTIL FOUND THE go.mod file
	SetGoModuleAsWorkingDir(t)

	appEnv := os.Getenv("APP_ENV")
	if appEnv == "" {
		appEnv = "testing"
	}
	config, err := core.LoadConfig(appEnv, true)
	wd, _ := os.Getwd()
	println(wd)
	if err != nil {
		t.Fatal(err)
	}

	fileSystem := os.DirFS(".")
	return config, fileSystem
}

// SetGoModuleAsWorkingDir changes the current working directory to the Go module root
// (the directory containing go.mod). It fails the test with an error message if
// the go.mod file cannot be found or if changing directory fails.
func SetGoModuleAsWorkingDir(t *testing.T) {
	// Get current working directory
	startDir, err := os.Getwd()
	if err != nil {
		t.Fatalf("Failed to get current working directory: %v", err)
	}

	// Search up for go.mod
	dir := startDir
	for {
		// Check if go.mod exists in the current directory
		modPath := filepath.Join(dir, "go.mod")
		if _, err := os.Stat(modPath); err == nil {
			// Found it! Change working directory if not already there
			if dir != startDir {
				if err := os.Chdir(dir); err != nil {
					t.Fatalf("Failed to change working directory to module root: %v", err)
				}
				t.Logf("Changed working directory to Go module root: %s", dir)
			} else {
				t.Logf("Already in Go module root: %s", dir)
			}
			return
		}

		// Move up to parent directory
		parentDir := filepath.Dir(dir)

		// If we're at the root and haven't found go.mod, fail the test
		if parentDir == dir {
			t.Fatalf("No go.mod file found in this directory or any parent directories")
		}

		// Continue with parent directory
		dir = parentDir
	}
}
