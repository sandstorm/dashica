// Tests for CheckAppSecret, the source order of LoadConfig and the reference dashica_config.example.yaml.
package config

import (
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/knadh/koanf/parsers/yaml"
	"github.com/knadh/koanf/providers/confmap"
	"github.com/knadh/koanf/v2"
)

func TestCheckAppSecret_WantsALongEnoughSecret(t *testing.T) {
	for secret, ok := range map[string]bool{"": false, "short": false, strings.Repeat("x", MinAppSecretLength-1): false, strings.Repeat("x", MinAppSecretLength): true} {
		if err := (&Config{AppSecret: secret}).CheckAppSecret(); (err == nil) != ok {
			t.Errorf("%d characters: %v", len(secret), err)
		}
	}
}

// loadIn is LoadConfig("testing") in a directory holding `file` as dashica_config.testing.yaml.
func loadIn(t *testing.T, file string) *Config {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "dashica_config.testing.yaml"), []byte("clickhouse:\n  default:\n    url: http://127.0.0.1:1\n    database: default\n"+file), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Chdir(dir)
	cfg, err := LoadConfig("testing", false)
	if err != nil {
		t.Fatal(err)
	}
	return cfg
}

func TestLoadConfig_TheDefaults(t *testing.T) {
	cfg := loadIn(t, "")
	if cfg.ServerPort != 8081 || !cfg.LogToStdout || cfg.LogFilename != "" || cfg.ExploreEnabled || cfg.SqlFilterEnabled || cfg.AppSecret != "" {
		t.Errorf("defaults: %+v", cfg)
	}
}

func TestLoadConfig_TheFileOverTheDefaults(t *testing.T) {
	cfg := loadIn(t, "server_port: 9000\nlog_to_stdout: false\nexplore_enabled: true\nsql_filter_enabled: true\napp_secret: from-the-file\n")
	if cfg.ServerPort != 9000 || cfg.LogToStdout || !cfg.ExploreEnabled || !cfg.SqlFilterEnabled || cfg.AppSecret != "from-the-file" {
		t.Errorf("from the file: %+v", cfg)
	}
}

func TestLoadConfig_TheEnvironmentOverTheFile(t *testing.T) {
	for value, want := range map[string]bool{"true": true, "false": false} {
		t.Run(value, func(t *testing.T) {
			t.Setenv("SQL_FILTER_ENABLED", value)
			t.Setenv("EXPLORE_ENABLED", value)
			t.Setenv("SERVER_PORT", "9001")
			t.Setenv("APP_SECRET", "from-the-environment")
			t.Setenv("CLICKHOUSE__DEFAULT__PASSWORD", "from-the-environment")
			cfg := loadIn(t, "server_port: 9000\nexplore_enabled: "+map[bool]string{true: "false", false: "true"}[want]+"\nsql_filter_enabled: "+map[bool]string{true: "false", false: "true"}[want]+"\napp_secret: from-the-file\n")
			if cfg.SqlFilterEnabled != want || cfg.ExploreEnabled != want || cfg.ServerPort != 9001 || cfg.AppSecret != "from-the-environment" || cfg.ClickHouse["default"].Password != "from-the-environment" {
				t.Errorf("SQL_FILTER_ENABLED=%s: %+v", value, cfg)
			}
		})
	}
}

// keysOf are the koanf keys of the struct type `typ`, under `prefix`; a map's entries are under `<connection>`.
func keysOf(typ reflect.Type, prefix string) []string {
	var keys []string
	for i := range typ.NumField() {
		field := typ.Field(i)
		key := prefix + field.Tag.Get("koanf")
		switch field.Type.Kind() {
		case reflect.Struct:
			keys = append(keys, keysOf(field.Type, key+".")...)
		case reflect.Map:
			keys = append(keys, keysOf(field.Type.Elem(), key+".<connection>.")...)
		default:
			keys = append(keys, key)
		}
	}
	return keys
}

// commentedKey is a line of the reference that is a key commented out: `#key:` at the top, `#  key:` below.
var commentedKey = regexp.MustCompile(`^#(  |[^ #])`)

// envLine is the reference's `# env: NAME` line, at any level.
var envLine = regexp.MustCompile(`^#(?:\s*#)? env: (\S+)$`)

func TestTheReferenceNamesEveryKeyAndItsEnvironmentVariable(t *testing.T) {
	text, err := os.ReadFile("../../dashica_config.example.yaml")
	if err != nil {
		t.Fatal(err)
	}
	var uncommented []string
	var envKeys []string
	for line := range strings.SplitSeq(string(text), "\n") {
		if m := envLine.FindStringSubmatch(line); m != nil {
			envKeys = append(envKeys, envTransformFunc(m[1]))
		}
		if commentedKey.MatchString(line) {
			uncommented = append(uncommented, line[1:])
		}
	}
	parsed, err := yaml.Parser().Unmarshal([]byte(strings.Join(uncommented, "\n")))
	if err != nil {
		t.Fatal(err)
	}
	k := koanf.New(".")
	if err := k.Load(confmap.Provider(parsed, "."), nil); err != nil {
		t.Fatal(err)
	}
	connection := regexp.MustCompile(`^clickhouse\.[a-z_]+\.`)
	generic := func(keys []string) []string {
		var out []string
		for _, key := range keys {
			out = append(out, connection.ReplaceAllString(key, "clickhouse.<connection>."))
		}
		slices.Sort(out)
		return slices.Compact(out)
	}
	want := generic(keysOf(reflect.TypeFor[Config](), ""))
	if got := generic(k.Keys()); !slices.Equal(got, want) {
		t.Errorf("the reference's keys\n%v\nthe Config's\n%v", got, want)
	}
	if got := generic(envKeys); !slices.Equal(got, want) {
		t.Errorf("the reference's env lines name\n%v\nthe Config's keys\n%v", got, want)
	}
}
