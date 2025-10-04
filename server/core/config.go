package core

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

// AppConfig is the main config struct which is returned from LoadConfig.
type AppConfig struct {
	// Map of ClickHouse configurations indexed by server alias
	ClickHouse map[string]ClickHouseConfig `koanf:"clickhouse"`
	Log        LogConfig                   `koanf:"log"`

	LetsEncrypt LetsEncryptConfig `koanf:"letsencrypt"`
	// DevMode:
	// - disables File System embed (=hot reloading during development)
	// - adds Observable Framework Reverse proxy (to prevent CORS) towards the Observable Framework server (=hot reloading of notebooks during dev)
	// - enables /api/debug-calculate-alerts
	DevMode  bool           `koanf:"dev_mode"`
	Auth     AuthConfig     `koanf:"auth"`
	Alerting AlertingConfig `koanf:"alerting"`
}
type LogConfig struct {
	ToStdout  bool   `koanf:"to_stdout"`
	FileName  string `koanf:"filename"`
	HostGroup string `koanf:"host_group"`
	HostName  string `koanf:"host_name"`
}

// ClickHouseConfig holds configuration for a single ClickHouse server
type ClickHouseConfig struct {
	URL               string   `koanf:"url"`
	User              string   `koanf:"user"`
	Password          string   `koanf:"password"`
	Database          string   `koanf:"database"`
	QueryFilePatterns []string `koanf:"query_file_patterns"`
}

// TODO: currently not supported
type AuthConfig struct {
	Enabled  bool   `koanf:"enabled"`
	Username string `koanf:"username"`
	Password string `koanf:"password"`
}

type AlertingConfig struct {
	HelvetikitAlertingUrl string `koanf:"helvetikit_alerting_url"`
	HelvetikitIdGroup     string `koanf:"helvetikit_id_group"`
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
func LoadConfig(appEnv string, forTesting bool) (*AppConfig, error) {
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
	config := &AppConfig{}
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
		"logs.stdout":                         true,
		"logs.filename":                       "app.log",
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

func validateConfig(config *AppConfig) error {
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
func PrintConfig(config *AppConfig) {
	fmt.Println("============= CONFIG ====================")
	fmt.Println("clickhouse:")
	for key, ch := range config.ClickHouse {
		fmt.Printf("  \"%s\":\n", key)
		fmt.Printf("    url: %s\n", ch.URL)
		fmt.Printf("    user: %s\n", ch.User)
		fmt.Printf("    password: %s\n", maskSecret(ch.Password))
		fmt.Printf("    database: %s\n", ch.Database)
		fmt.Printf("    query_file_patterns: %s\n", ch.QueryFilePatterns)
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
