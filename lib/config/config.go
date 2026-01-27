package config

import (
	"context"
	"log"
	"os"

	"github.com/Azhovan/rigging"
	"github.com/Azhovan/rigging/sourceenv"
	"github.com/Azhovan/rigging/sourcefile"
)

type Config struct {
	Log LoggingConfig
}

func (c Config) Print() {
	println("=== DASHICA ACTIVE CONFIGURATION ===")
	_ = rigging.DumpEffective(os.Stdout, &c, rigging.WithSources())
}

type LoggingConfig struct {
	OutputFilePath string
	ToStdout       bool `conf:"default:true"`
}

func LoadConfigAndFailOnError(print bool) *Config {
	loader := rigging.NewLoader[Config]().
		WithSource(sourcefile.New("dashica_config.yaml", sourcefile.Options{})).
		WithSource(sourceenv.New(sourceenv.Options{Prefix: "APP_"}))

	cfg, err := loader.Load(context.Background())
	if err != nil {
		log.Fatal(err)
	}

	return cfg
}
