package dashica

import (
	"net/http"
	"os"
	"time"

	"github.com/rs/zerolog"
	alerting2 "github.com/sandstorm/dashica/lib/alerting"
	"github.com/sandstorm/dashica/lib/clickhouse"
	"github.com/sandstorm/dashica/lib/config"
	"github.com/sandstorm/dashica/lib/dashboard"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/logging"
	"github.com/sandstorm/dashica/lib/util/handler_collector"
	app "github.com/sandstorm/dashica/server"
	"gopkg.in/natefinch/lumberjack.v2"
)

type Dashica interface {
	http.Handler
	Config() config.Config
	Log() zerolog.Logger
	RegisterDashboardGroup(title string) Dashica
	RegisterDashboard(url string, dashboard dashboard.Dashboard) Dashica
	ScanAndRegisterMarkdownDashboards(baseDir string, pathPrefix string) Dashica
}

func New() Dashica {
	cfg, err := config.LoadConfig(os.Getenv("APP_ENV"), false)
	if err != nil {
		println("Failed to load config: ", err.Error())
		os.Exit(1)
	}

	// --- Logger initialization ---

	zerolog.TimeFieldFormat = zerolog.TimeFormatUnixMicro // see clickhouse init-db.sql - monitoring.full_logs.timestamp
	zerolog.DurationFieldUnit = time.Millisecond          // see clickhouse init-db.sql - monitoring.full_logs.event_duration_ms
	zerolog.DurationFieldInteger = true                   // see clickhouse init-db.sql - monitoring.full_logs.event_duration_ms
	zerolog.TimestampFieldName = "timestamp"              // compatible with vector.dev

	var logger zerolog.Logger
	logWriter := &lumberjack.Logger{
		Filename:   cfg.Log.FileName,
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

	timeProvider := config.NewRealTimeProvider()
	clickhouseClientManager := clickhouse.NewManager(cfg, logger)

	workingDir, err := os.Getwd()
	if err != nil {
		logger.Fatal().
			Str(logging.EventDataset, logging.EventDataset_Dashica_Startup).
			Err(err).
			Msg("could not find working directory")
	}

	fileSystem := app.GetFileSystem(workingDir)
	alertTargetClickhouseClient, err := clickhouseClientManager.GetClient("alert_storage")
	if err != nil {
		logger.Fatal().
			Str(logging.EventDataset, logging.EventDataset_Dashica_Startup).
			Msg("did NOT find clickhouse 'alert_target' (needed for alert result storage) in dashica_config.yaml.")
	}
	alertResultStore := alerting2.NewAlertResultStore(logger, alertTargetClickhouseClient)
	alertEvaluator := alerting2.NewAlertEvaluator(logger, clickhouseClientManager, timeProvider)
	alertManager := alerting2.NewAlertManager(cfg, logger, fileSystem, alertEvaluator, alertResultStore)

	deps := rendering.Dependencies{
		clickhouseClientManager,
		logger,
		timeProvider,
		fileSystem,
		alertResultStore,
		alertEvaluator,
		alertManager,
	}

	return &DashicaImpl{
		cfg:              cfg,
		log:              logger,
		handler:          mux,
		handlerCollector: handler_collector.NewValidatingCollector(mux, logger),
		deps:             deps,
	}
}

type DashicaImpl struct {
	cfg              *config.Config
	log              zerolog.Logger
	handler          http.Handler
	dashboardGroups  []rendering.MenuGroup
	handlerCollector handler_collector.HandlerCollector
	deps             rendering.Dependencies
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
	d.dashboardGroups = append(d.dashboardGroups, rendering.MenuGroup{Title: title})
	return d
}

func (d *DashicaImpl) RegisterDashboard(url string, dashb dashboard.Dashboard) Dashica {
	d.log.Info().
		Str("url", url).
		Msg("Registering new dashboard")

	dashb.CollectHandlers(
		rendering.DashboardContext{
			MainMenu:          &d.dashboardGroups,
			CurrentHandlerUrl: url,
			Deps:              d.deps,
		},
		d.handlerCollector.Nested(url),
	)

	// add to the last dashboard group
	d.dashboardGroups[len(d.dashboardGroups)-1].Entries = append(d.dashboardGroups[len(d.dashboardGroups)-1].Entries, rendering.MenuGroupEntry{
		Title: url,
		Url:   url,
	})
	return d
}

var _ Dashica = (*DashicaImpl)(nil)
