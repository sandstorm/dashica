package config

import (
	"errors"
	"fmt"
	"os"

	"github.com/knadh/koanf/providers/confmap"

	"strings"

	"github.com/knadh/koanf/parsers/yaml"
	"github.com/knadh/koanf/providers/env"
	"github.com/knadh/koanf/providers/file"
	"github.com/knadh/koanf/v2"
)

// Config is the main config struct which is returned from LoadConfig; dashica_config.example.yaml is its reference,
// every key with its default and its environment variable.
type Config struct {
	// AppSecret is the key of the HMAC on everything the server hands to the browser and takes back (a pill, a filter
	// button), so that the conditions of a page's URL are the server's own; required (CheckAppSecret). Never in a
	// checked-in file: set it as APP_SECRET.
	AppSecret string `koanf:"app_secret"`
	// Map of ClickHouse configurations indexed by server alias
	ClickHouse map[string]ClickHouseConfig `koanf:"clickhouse"`
	// ServerPort is the port the HTTP server listens on.
	ServerPort int `koanf:"server_port"`
	// LogToStdout: the log goes to stderr too, beside the log file.
	LogToStdout bool `koanf:"log_to_stdout"`
	// LogFilename is the log file; empty, lumberjack's `<temp dir>/<binary>-lumberjack.log`.
	LogFilename string `koanf:"log_filename"`
	// ExploreEnabled: the Explore view is on, and every viewer may edit a chart's SQL in it and run it, read-only, on
	// the chart's ClickHouse connection, raw rows included; off by default, since they may hold personal data the chart
	// aggregates away. Off, the client leaves the view out and its endpoints answer 404.
	ExploreEnabled bool `koanf:"explore_enabled"`
	// SqlFilterEnabled: the page's SQL chips (`?sql=`) go into every query's WHERE, and the filter bar lets the viewer
	// type them; off by default, since a SQL chip is the viewer's own SQL. Off, every query a SQL chip would enter
	// answers it with 400 (httpserver.QueryState.SqlClause).
	SqlFilterEnabled bool           `koanf:"sql_filter_enabled"`
	Alerting         AlertingConfig `koanf:"alerting"`
}

// MinAppSecretLength is the shortest app_secret the server starts with (`openssl rand -hex 32` gives 64).
const MinAppSecretLength = 32

// CheckAppSecret is why the server cannot start with `c`'s app_secret: missing or shorter than MinAppSecretLength;
// nil when it can.
func (c *Config) CheckAppSecret() error {
	if len(c.AppSecret) < MinAppSecretLength {
		return fmt.Errorf("app_secret must be set, at least %d characters (signs the page's filters; e.g. APP_SECRET=$(openssl rand -hex 32))", MinAppSecretLength)
	}
	return nil
}

// ClickHouseConfig holds configuration for a single ClickHouse server
type ClickHouseConfig struct {
	URL      string `koanf:"url"`
	User     string `koanf:"user"`
	Password string `koanf:"password"`
	Database string `koanf:"database"`
}

type AlertingConfig struct {
	HelvetikitAlertingUrl    string `koanf:"helvetikit_alerting_url"`
	HelvetikitIdGroup        string `koanf:"helvetikit_id_group"`
	AlertCronMonitorSchedule string `koanf:"alert_cron_monitor_schedule"`
	AlertCronMonitorUrl      string `koanf:"alert_cron_monitor_url"`
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
		"server_port":   8081,
		"log_to_stdout": true,
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

// loadEnvVariables loads env vars to config, lower-cased, "__" joining the levels:
// APP_SECRET -> app_secret, CLICKHOUSE__DEFAULT__PASSWORD -> clickhouse.default.password
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

	fmt.Printf("app_secret: %s\n", maskSecret(config.AppSecret))
	fmt.Printf("server_port: %d\n", config.ServerPort)
	fmt.Printf("log_to_stdout: %v\n", config.LogToStdout)
	fmt.Printf("log_filename: %s\n", config.LogFilename)
	fmt.Printf("explore_enabled: %v\n", config.ExploreEnabled)
	fmt.Printf("sql_filter_enabled: %v\n", config.SqlFilterEnabled)

	fmt.Println("alerting:")
	fmt.Printf("  helvetikit_alerting_url: %s\n", config.Alerting.HelvetikitAlertingUrl)
	fmt.Printf("  helvetikit_id_group: %s\n", config.Alerting.HelvetikitIdGroup)
	fmt.Printf("  alert_cron_monitor_schedule: %s\n", config.Alerting.AlertCronMonitorSchedule)
	fmt.Printf("  alert_cron_monitor_url: %s\n", config.Alerting.AlertCronMonitorUrl)
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
