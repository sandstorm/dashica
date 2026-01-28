package dashica

import (
	"net/http"
	"os"
	"time"

	"github.com/rs/zerolog"
	"github.com/sandstorm/dashica/lib/config"
	"github.com/sandstorm/dashica/lib/dashboard"
	"github.com/sandstorm/dashica/lib/logging"
	"github.com/sandstorm/dashica/lib/util/handler_collector"
	"gopkg.in/natefinch/lumberjack.v2"
)

type Dashica interface {
	http.Handler
	Config() config.Config
	Log() zerolog.Logger
	RegisterDashboardGroup(title string) Dashica
	RegisterDashboard(url string, dashboard dashboard.Dashboard) Dashica
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
		Str(logging.EventDataset, logging.EventDataset_Dashica_Startup).
		Msg("Logging initialized. Starting to boot Dashica...")

	mux := http.NewServeMux()
	mux.Handle("/public/", http.StripPrefix("/public/", http.FileServer(http.Dir("dashica-src/public/"))))

	return &DashicaImpl{
		cfg:              cfg,
		log:              logger,
		handler:          mux,
		handlerCollector: handler_collector.NewValidatingCollector(mux, logger),
	}
}

type DashicaImpl struct {
	cfg              *config.Config
	log              zerolog.Logger
	handler          http.Handler
	dashboardGroups  []dashboard.DashboardGroup
	handlerCollector handler_collector.HandlerCollector
}

func (d *DashicaImpl) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	d.handler.ServeHTTP(w, r)
}

func (d *DashicaImpl) Config() config.Config {
	return *d.cfg
}

func (d *DashicaImpl) Log() zerolog.Logger {
	return d.log
}

func (d *DashicaImpl) RegisterDashboardGroup(title string) Dashica {
	d.dashboardGroups = append(d.dashboardGroups, dashboard.DashboardGroup{Title: title})
	return d
}

func (d *DashicaImpl) RegisterDashboard(url string, dashb dashboard.Dashboard) Dashica {
	d.log.Info().
		Str("url", url).
		Msg("Registering new dashboard")

	dashb.CollectHandlers(
		d.handlerCollector.Nested(url),
		dashboard.DashboardExecutionContext{
			DashboardGroups:   &d.dashboardGroups,
			CurrentHandlerUrl: url,
		},
	)

	// add to the last dashboard group
	d.dashboardGroups[len(d.dashboardGroups)-1].Entries = append(d.dashboardGroups[len(d.dashboardGroups)-1].Entries, dashboard.DashboardGroupEntry{
		Title:     url,
		Url:       url,
		Dashboard: dashb,
	})
	return d
}

var _ Dashica = (*DashicaImpl)(nil)
