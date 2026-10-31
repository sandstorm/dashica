package config

import (
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/knadh/koanf/providers/confmap"

	"strings"

	"github.com/knadh/koanf/parsers/yaml"
	"github.com/knadh/koanf/providers/env"
	"github.com/knadh/koanf/providers/file"
	"github.com/knadh/koanf/v2"
)

// Config is the main config struct which is returned from LoadConfig.
type Config struct {
	// Map of ClickHouse configurations indexed by server alias
	ClickHouse map[string]ClickHouseConfig `koanf:"clickhouse"`
	Log        LogConfig                   `koanf:"log"`
	Server     ServerConfig                `koanf:"server"`

	LetsEncrypt LetsEncryptConfig `koanf:"letsencrypt"`
	// DevMode:
	// - disables File System embed (=hot reloading during development)
	// - adds Observable Framework Reverse proxy (to prevent CORS) towards the Observable Framework server (=hot reloading of notebooks during dev)
	// - enables /api/debug-calculate-alerts
	DevMode  bool           `koanf:"dev_mode"`
	Auth     AuthConfig     `koanf:"auth"`
	Alerting AlertingConfig `koanf:"alerting"`
	Explore  ExploreConfig  `koanf:"explore"`
	Filters  FiltersConfig  `koanf:"filters"`
}

// FiltersConfig is how the server signs the page's pills and whether it takes SQL chips (docs/2026-10-28-workbench.md
// §3.8, §3.15).
type FiltersConfig struct {
	// Secret is the key of the HMAC each pill carries, so that the conditions of a page's URL are the server's own;
	// required (CheckFilterSecret). Never in a checked-in file: set it as FILTERS__SECRET.
	Secret string `koanf:"secret"`
	// SqlEnabled: the page's SQL chips (`?sql=`) go into every query's WHERE, and the filter bar lets the viewer type
	// them; off by default, since a SQL chip is the viewer's own SQL. Off, every handler that reads the query state
	// answers a `sql` with 400 (httpserver.ParseQueryState). FILTERS__SQLENABLED=true sets it from the environment.
	SqlEnabled bool `koanf:"sqlEnabled"`
}

// MinFilterSecretLength is the shortest filters.secret the server starts with (`openssl rand -hex 32` gives 64).
const MinFilterSecretLength = 32

// CheckFilterSecret is why the server cannot start with `c`'s filters.secret: missing or shorter than
// MinFilterSecretLength; nil when it can.
func (c FiltersConfig) CheckFilterSecret() error {
	if len(c.Secret) < MinFilterSecretLength {
		return fmt.Errorf("filters.secret must be set, at least %d characters (signs the page's filters; e.g. FILTERS__SECRET=$(openssl rand -hex 32))", MinFilterSecretLength)
	}
	return nil
}

// ExploreConfig is what the Explore view may show beyond what the charts show.
type ExploreConfig struct {
	// Enabled: the Explore view is on, and every viewer may edit a chart's SQL in it and run it, read-only, on the
	// chart's ClickHouse connection, raw rows included; off by default, since they may hold personal data the chart
	// aggregates away. Off, the client leaves the view out and its endpoints answer 404.
	Enabled bool `koanf:"enabled"`
}

type ServerConfig struct {
	Port int `koanf:"port"`
}

type LogConfig struct {
	ToStdout  bool   `koanf:"to_stdout"`
	FileName  string `koanf:"filename"`
	HostGroup string `koanf:"host_group"`
	HostName  string `koanf:"host_name"`
}

// ClickHouseConfig holds configuration for a single ClickHouse server
type ClickHouseConfig struct {
	URL      string `koanf:"url"`
	User     string `koanf:"user"`
	Password string `koanf:"password"`
	Database string `koanf:"database"`
}

// TODO: currently not supported
type AuthConfig struct {
	Enabled  bool   `koanf:"enabled"`
	Username string `koanf:"username"`
	Password string `koanf:"password"`
}

type AlertingConfig struct {
	HelvetikitAlertingUrl    string `koanf:"helvetikit_alerting_url"`
	HelvetikitIdGroup        string `koanf:"helvetikit_id_group"`
	AlertCronMonitorSchedule string `koanf:"alert_cron_monitor_schedule"`
	AlertCronMonitorUrl      string `koanf:"alert_cron_monitor_url"`
}

// TODO: currently not supported
type LetsEncryptConfig struct {
	Enabled               bool          `koanf:"enabled"`
	DevUseStagingCa       bool          `koanf:"dev_use_staging_ca"`
	DevCustomCa           string        `koanf:"dev_custom_ca"`
	Email                 string        `koanf:"email"`
	Domain                string        `koanf:"domain"`
	DevHttpPort           int           `koanf:"dev_http_port"`
	DevHttpsPort          int           `koanf:"dev_https_port"`
	DevCertRenewInterval  time.Duration `koanf:"dev_cert_renew_interval"`
	ManualRefreshInterval time.Duration `koanf:"manual_refresh_interval"`
	ManualCertfile        string        `koanf:"manual_certfile"`
	ManualKeyfile         string        `koanf:"manual_keyfile"`
}

// LoadConfig loads configuration from various sources and returns the parsed config
func LoadConfig(appEnv string, forTesting bool) (*Config, error) {
	k := koanf.New(".")

	// Load default configuration values
	if err := loadDefaultConfig(k); err != nil {
		return nil, fmt.Errorf("loading default configuration: %w", err)
	}

	// Load environment variables
	if err := loadDashicaConfig(k, appEnv); err != nil {
		return nil, fmt.Errorf("loading dotenv variables: %w", err)
	}

	if !forTesting {
		// Load environment variables
		if err := loadEnvVariables(k); err != nil {
			return nil, fmt.Errorf("loading environment variables: %w", err)
		}
	}

	// Unmarshal configuration into struct
	config := &Config{}
	if err := k.Unmarshal("", config); err != nil {
		return nil, fmt.Errorf("unmarshaling configuration: %w", err)
	}

	// for debugging:
	//k.Print()

	// Validate config
	if err := validateConfig(config); err != nil {
		return nil, err
	}

	return config, nil
}

func loadDefaultConfig(k *koanf.Koanf) error {
	// Setup default values
	defaultConfig := map[string]interface{}{
		"server.port":                         8081,
		"log.to_stdout":                       true,
		"letsencrypt.enabled":                 false,
		"letsencrypt.dev_http_port":           80,
		"letsencrypt.dev_https_port":          443,
		"letsencrypt.dev_cert_renew_interval": time.Hour * 24,
		"letsencrypt.manual_refresh_interval": time.Hour * 24,
		"auth.password":                       "",
	}

	return k.Load(confmap.Provider(defaultConfig, "."), nil)
}

func loadDashicaConfig(k *koanf.Koanf, appEnv string) error {
	err := k.Load(file.Provider(fmt.Sprintf("dashica_config.%s.yaml", appEnv)), yaml.Parser())
	if err != nil && errors.Is(err, os.ErrNotExist) {
		// dashica_config.[APP_ENV].yaml does not exist; try to load .env as fallback
		err = k.Load(file.Provider("dashica_config.yaml"), yaml.Parser())
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	return err
}
func envTransformFunc(s string) string {
	s = strings.ToLower(s)
	s = strings.ReplaceAll(s, "__", ".")
	return s
}

// loadEnvVariables loads env vars to config:
// Format: SECTION__KEY_stuff -> section.key_stuff
// see https://github.com/knadh/koanf/issues/74
func loadEnvVariables(k *koanf.Koanf) error {
	return k.Load(env.Provider("", ".", envTransformFunc), nil)
}

func validateConfig(config *Config) error {
	// Check if we have at least one ClickHouse configuration
	if len(config.ClickHouse) == 0 {
		return fmt.Errorf("no ClickHouse configurations found")
	}

	// Validate each ClickHouse configuration
	for key, ch := range config.ClickHouse {
		if ch.URL == "" {
			return fmt.Errorf("ClickHouse %s': URL is required", key)
		}

		if ch.Database == "" {
			return fmt.Errorf("ClickHouse '%s': database is required", key)
		}
	}

	if config.Auth.Enabled {
		if config.Auth.Username == "" {
			return fmt.Errorf("username must be configured if auth is enabled")
		}
		if config.Auth.Password == "" {
			// TODO: and password is bcrypt string
			return fmt.Errorf("password must be configured if auth is enabled")
		}
	}

	return nil
}

// PrintConfig prints the current configuration (with sensitive data masked)
func PrintConfig(config *Config) {
	fmt.Println("============= CONFIG ====================")
	fmt.Println("clickhouse:")
	for key, ch := range config.ClickHouse {
		fmt.Printf("  \"%s\":\n", key)
		fmt.Printf("    url: %s\n", ch.URL)
		fmt.Printf("    user: %s\n", ch.User)
		fmt.Printf("    password: %s\n", maskSecret(ch.Password))
		fmt.Printf("    database: %s\n", ch.Database)
	}

	fmt.Println("log:")
	fmt.Printf("  to_stdout: %v\n", config.Log.ToStdout)
	fmt.Printf("  filename: %s\n", config.Log.FileName)
	fmt.Printf("  host_group: %s\n", config.Log.HostGroup)
	fmt.Printf("  host_name: %s\n", config.Log.HostName)

	fmt.Println("Let's Encrypt Configuration:")
	fmt.Printf("  Enabled: %v\n", config.LetsEncrypt.Enabled)
	if config.LetsEncrypt.Enabled {
		fmt.Printf("  Email: %s\n", config.LetsEncrypt.Email)
		fmt.Printf("  Domain: %s\n", config.LetsEncrypt.Domain)
		// Print other Let's Encrypt settings if needed
	}

	fmt.Printf("dev_mode: %v\n", config.DevMode)

	fmt.Println("Authentication Configuration:")
	fmt.Printf("  Enabled: %v\n", config.Auth.Enabled)
	if config.Auth.Enabled {
		fmt.Printf("  Username: %s\n", config.Auth.Username)
		fmt.Printf("  Password: %s\n", maskSecret(config.Auth.Password))
	}

	fmt.Printf("explore.enabled: %v\n", config.Explore.Enabled)
	fmt.Printf("filters.secret: %s\n", maskSecret(config.Filters.Secret))
	fmt.Printf("filters.sqlEnabled: %v\n", config.Filters.SqlEnabled)

	fmt.Println("Alerting Configuration:")
	fmt.Printf("  helvetikit_alerting_url: %s\n", config.Alerting.HelvetikitAlertingUrl)
	fmt.Printf("  helvetikit_id_group: %s\n", config.Alerting.HelvetikitIdGroup)
	fmt.Println("=========================================")
}

// Helper function to mask sensitive data
func maskSecret(s string) string {
	if s == "" {
		return ""
	}
	if len(s) <= 4 {
		return "****"
	}
	return s[:1] + "****" + s[len(s)-1:]
}
