// Tests for CheckFilterSecret and filters.sqlEnabled from the config file and the environment.
package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/knadh/koanf/parsers/yaml"
	"github.com/knadh/koanf/providers/file"
	"github.com/knadh/koanf/v2"
)

func TestCheckFilterSecret_WantsALongEnoughSecret(t *testing.T) {
	for secret, ok := range map[string]bool{"": false, "short": false, strings.Repeat("x", MinFilterSecretLength-1): false, strings.Repeat("x", MinFilterSecretLength): true} {
		if err := (FiltersConfig{Secret: secret}).CheckFilterSecret(); (err == nil) != ok {
			t.Errorf("%d characters: %v", len(secret), err)
		}
	}
}

func TestFiltersSqlEnabled_FromTheEnvironment(t *testing.T) {
	for value, want := range map[string]bool{"true": true, "false": false} {
		t.Setenv("FILTERS__SQLENABLED", value)
		k := koanf.New(".")
		if err := loadEnvVariables(k); err != nil {
			t.Fatal(err)
		}
		var cfg Config
		if err := k.Unmarshal("", &cfg); err != nil {
			t.Fatal(err)
		}
		if cfg.Filters.SqlEnabled != want {
			t.Errorf("FILTERS__SQLENABLED=%s: filters.sqlEnabled = %v", value, cfg.Filters.SqlEnabled)
		}
	}
}

func TestFiltersSqlEnabled_FromTheConfigFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "dashica_config.yaml")
	if err := os.WriteFile(path, []byte("filters:\n  sqlEnabled: true\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	k := koanf.New(".")
	if err := k.Load(file.Provider(path), yaml.Parser()); err != nil {
		t.Fatal(err)
	}
	var cfg Config
	if err := k.Unmarshal("", &cfg); err != nil {
		t.Fatal(err)
	}
	if !cfg.Filters.SqlEnabled {
		t.Error("filters.sqlEnabled: true in the file, off in the config")
	}
}
