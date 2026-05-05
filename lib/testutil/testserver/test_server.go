package testserver

import (
	"io/fs"
	"os"
	"path/filepath"
	"testing"

	"github.com/sandstorm/dashica/lib/config"
)

func LoadTestingConfig(t *testing.T) (*config.Config, fs.FS) {
	// ITERATE UP IN WORKING DIRECTORY UNTIL FOUND THE go.mod file
	SetGoModuleAsWorkingDir(t)

	appEnv := os.Getenv("APP_ENV")
	if appEnv == "" {
		appEnv = "testing"
	}
	cfg, err := config.LoadConfig(appEnv, true)
	wd, _ := os.Getwd()
	println(wd)
	if err != nil {
		t.Fatal(err)
	}

	fileSystem := os.DirFS(".")
	return cfg, fileSystem
}

// SetGoModuleAsWorkingDir changes the current working directory to the Go module root
// (the directory containing go.mod). It fails the test with an error message if
// the go.mod file cannot be found or if changing directory fails.
func SetGoModuleAsWorkingDir(t *testing.T) {
	startDir, err := os.Getwd()
	if err != nil {
		t.Fatalf("Failed to get current working directory: %v", err)
	}

	dir := startDir
	for {
		modPath := filepath.Join(dir, "go.mod")
		if _, err := os.Stat(modPath); err == nil {
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

		parentDir := filepath.Dir(dir)
		if parentDir == dir {
			t.Fatalf("No go.mod file found in this directory or any parent directories")
		}
		dir = parentDir
	}
}
