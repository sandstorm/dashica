package dashica

import (
	"os"
	"time"

	"github.com/rs/zerolog"
	"github.com/sandstorm/dashica/lib/config"
	"github.com/sandstorm/dashica/lib/logging"
	"gopkg.in/natefinch/lumberjack.v2"
)

type Dashica interface {
	Config() config.Config
}

func New() Dashica {
	cfg := config.LoadConfigAndFailOnError(true)

	// --- Logger initialization ---

	zerolog.TimeFieldFormat = zerolog.TimeFormatUnixMicro // see clickhouse init-db.sql - monitoring.full_logs.timestamp
	zerolog.DurationFieldUnit = time.Millisecond          // see clickhouse init-db.sql - monitoring.full_logs.event_duration_ms
	zerolog.DurationFieldInteger = true                   // see clickhouse init-db.sql - monitoring.full_logs.event_duration_ms
	zerolog.TimestampFieldName = "timestamp"              // compatible with vector.dev

	var logger zerolog.Logger
	logWriter := &lumberjack.Logger{
		Filename:   cfg.Log.OutputFilePath,
		MaxSize:    500, // megabytes
		MaxBackups: 3,
		MaxAge:     28, // days
	}

	if cfg.Log.ToStdout {
		logger = zerolog.New(zerolog.MultiLevelWriter(zerolog.ConsoleWriter{Out: os.Stderr}, logWriter))
	} else {
		logger = zerolog.New(zerolog.MultiLevelWriter(logWriter))
	}
	logger = logger.With().
		Str(logging.EventModule, "dashica").
		Timestamp().Logger()

	// NOTE: we also register the logger as the default context logger; this is used if for some reason no logger
	// with a request ID is stored in the context.
	zerolog.DefaultContextLogger = &logger

	logger.Info().
		Str(logging.EventDataset, logging.EventDataset_Falco_Startup).
		Msg("Logging initialized. Starting to boot Falco Reactor...")

	return &DashicaImpl{
		cfg: cfg,
	}
}

type DashicaImpl struct {
	cfg *config.Config
}

func (d *DashicaImpl) Config() config.Config {
	return *d.cfg
}

var _ Dashica = (*DashicaImpl)(nil)
