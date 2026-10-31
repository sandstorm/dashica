package dashica

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/rs/zerolog"
	alerting2 "github.com/sandstorm/dashica/lib/alerting"
	"github.com/sandstorm/dashica/lib/clickhouse"
	"github.com/sandstorm/dashica/lib/config"
	"github.com/sandstorm/dashica/lib/dashboard"
	"github.com/sandstorm/dashica/lib/dashboard/rendering"
	"github.com/sandstorm/dashica/lib/dashboard/widget"
	"github.com/sandstorm/dashica/lib/httpserver"
	"github.com/sandstorm/dashica/lib/logging"
	"github.com/sandstorm/dashica/lib/util/handler_collector"
	"github.com/sandstorm/dashica/public"
	"gopkg.in/natefinch/lumberjack.v2"
)

type Dashica interface {
	http.Handler
	Config() config.Config
	Log() zerolog.Logger
	ListenAndServe() error
	RegisterDashboardGroup(title string) Dashica
	RegisterDashboard(url string, dashboard dashboard.Dashboard) Dashica
}

func New(projectFS fs.ReadFileFS) Dashica {
	cfg, err := config.LoadConfig(os.Getenv("APP_ENV"), false)
	if err != nil {
		println("Failed to load config: ", err.Error())
		os.Exit(1)
	}
	if err := cfg.Filters.CheckFilterSecret(); err != nil {
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
	mux.Handle("/public/", http.StripPrefix("/public/", http.FileServer(http.FS(public.FS))))

	timeProvider := config.NewRealTimeProvider()
	clickhouseClientManager := clickhouse.NewManager(cfg, logger)

	alertTargetClickhouseClient, err := clickhouseClientManager.GetClient("alert_storage")
	if err != nil {
		logger.Fatal().
			Str(logging.EventDataset, logging.EventDataset_Dashica_Startup).
			Msg("did NOT find clickhouse 'alert_target' (needed for alert result storage) in dashica_config.yaml.")
	}
	alertResultStore := alerting2.NewAlertResultStore(logger, alertTargetClickhouseClient)
	alertEvaluator := alerting2.NewAlertEvaluator(logger, clickhouseClientManager, timeProvider)
	alertManager := alerting2.NewAlertManager(cfg, logger, projectFS, alertEvaluator, alertResultStore)

	err = alertManager.DiscoverAlertDefinitions()
	if err != nil {
		logger.Warn().
			Str(logging.EventDataset, logging.EventDataset_Dashica_Startup).
			Err(err).
			Msg("Failed to discover alert definitions")
	}

	// Top-level signal handler. The gronx tasker (started by RunAlertScheduler) installs its own
	// signal.Notify for os.Interrupt and only stops itself, blocking on wg.Wait() for in-flight
	// tasks; further Ctrl-C is swallowed and the HTTP server / main never exit. This handler
	// guarantees Ctrl-C (and SIGTERM) always terminate the process. signal.Notify multiplexes to
	// all registered channels, so the tasker still receives the signal too.
	go func() {
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
		s := <-sig
		logger.Info().
			Str(logging.EventDataset, logging.EventDataset_Dashica_Startup).
			Str("signal", s.String()).
			Msg("shutdown signal received, exiting")
		os.Exit(0)
	}()

	go func() {
		if err := alertManager.RunAlertScheduler(); err != nil {
			logger.Error().
				Str(logging.EventDataset, logging.EventDataset_Dashica_Startup).
				Err(err).
				Msg("Alert scheduler failed")
		}
	}()

	deps := rendering.Dependencies{
		ClickhouseClientManager: clickhouseClientManager,
		Logger:                  logger,
		TimeProvider:            timeProvider,
		FileSystem:              projectFS,
		AlertResultStore:        alertResultStore,
		AlertEvaluator:          alertEvaluator,
		AlertManager:            alertManager,
		ExploreEnabled:          cfg.Explore.Enabled,
		FilterSecret:            []byte(cfg.Filters.Secret),
		SqlEnabled:              cfg.Filters.SqlEnabled,
	}

	return newDashicaImpl(cfg, logger, mux, deps)
}

// newDashicaImpl is a Dashica serving on `mux`, with /workbench.json, /time-range, /schema.json (the Schema view's,
// httpserver.SchemaHandler), /rows (a blank Explore tab's query, httpserver.ConnectionRowsHandler) and the start page
// "/", and no dashboards yet.
func newDashicaImpl(cfg *config.Config, logger zerolog.Logger, mux *http.ServeMux, deps rendering.Dependencies) *DashicaImpl {
	d := &DashicaImpl{
		cfg:              cfg,
		log:              logger,
		handler:          mux,
		handlerCollector: handler_collector.NewValidatingCollector(mux, logger),
		deps:             deps,
	}
	if err := d.handlerCollector.Handle("/workbench.json", http.HandlerFunc(d.serveWorkbenchJson)); err != nil {
		logger.Fatal().Err(err).Msg("Failed to register /workbench.json")
	}
	if err := d.handlerCollector.Handle("/time-range", httpserver.TimeRangeHandler{SqlEnabled: deps.SqlEnabled}); err != nil {
		logger.Fatal().Err(err).Msg("Failed to register /time-range")
	}
	schema := httpserver.SchemaHandler{ClickhouseClientManager: deps.ClickhouseClientManager, ExploreEnabled: deps.ExploreEnabled}
	if err := d.handlerCollector.Handle("/schema.json", schema); err != nil {
		logger.Fatal().Err(err).Msg("Failed to register /schema.json")
	}
	rows := httpserver.ConnectionRowsHandler{ClickhouseClientManager: deps.ClickhouseClientManager, ExploreEnabled: deps.ExploreEnabled}
	if err := d.handlerCollector.Handle("/rows", rows); err != nil {
		logger.Fatal().Err(err).Msg("Failed to register /rows")
	}
	if err := dashboard.CollectHome(d.handlerCollector); err != nil {
		logger.Fatal().Err(err).Msg("Failed to register the start page")
	}
	return d
}

// WorkbenchJson is what "/workbench.json" says about the whole Dashica: what the client needs before any page.
type WorkbenchJson struct {
	// Menu is the dashboards by group, in registration order, each with its outline.
	Menu []rendering.MenuGroup `json:"menu"`
	// Explore: the Explore view is on (explore.enabled); else the client leaves it out, and its endpoints answer 404.
	Explore bool `json:"explore"`
	// SqlEnabled: the filter bar lets the viewer type SQL chips (filters.sqlEnabled); else it offers none, and every
	// handler answers a `sql` with 400.
	SqlEnabled bool `json:"sqlEnabled"`
	// Connections are the names of the ClickHouse connections of dashica_config, sorted: the Schema view's tree.
	Connections []string `json:"connections"`
}

// serveWorkbenchJson serves the WorkbenchJson of the groups as they are when asked (dashboards register after New).
func (d *DashicaImpl) serveWorkbenchJson(w http.ResponseWriter, _ *http.Request) {
	menu := d.dashboardGroups
	if menu == nil {
		menu = []rendering.MenuGroup{}
	}
	connections := d.deps.ClickhouseClientManager.Connections()
	if connections == nil {
		connections = []string{}
	}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(WorkbenchJson{Menu: menu, Explore: d.deps.ExploreEnabled, SqlEnabled: d.deps.SqlEnabled, Connections: connections}); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

type DashicaImpl struct {
	cfg              *config.Config
	log              zerolog.Logger
	handler          http.Handler
	dashboardGroups  []rendering.MenuGroup
	handlerCollector handler_collector.HandlerCollector
	deps             rendering.Dependencies

	// exploreBaseURL is the registration URL of the Explore view once one is
	// registered (empty otherwise). Every DashboardContext carries a pointer to
	// this field, so the "Open in Explore" affordance appears regardless of
	// whether Explore is registered before or after the dashboards.
	//
	// Deprecated: (workbench) Explore's Go API, kept for its rebuild on the workbench; see docs/2026-10-28-workbench.md §5.
	exploreBaseURL string
}

// exploreView is the marker a dashboard implements to identify itself as the
// Explore editor. It is structural (Explore need not import this package); the
// method name doubles as documentation of intent.
//
// Deprecated: (workbench) Explore's Go API, kept for its rebuild on the workbench; see docs/2026-10-28-workbench.md §5.
type exploreView interface {
	IsExploreView() bool
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

func (d *DashicaImpl) ListenAndServe() error {
	addr := fmt.Sprintf(":%d", d.cfg.Server.Port)
	d.log.Info().
		Int("port", d.cfg.Server.Port).
		Msg("Starting Dashica HTTP server")

	return http.ListenAndServe(addr, d)
}

func (d *DashicaImpl) RegisterDashboardGroup(title string) Dashica {
	d.dashboardGroups = append(d.dashboardGroups, rendering.MenuGroup{Title: title, Entries: []rendering.MenuGroupEntry{}})
	return d
}

func (d *DashicaImpl) RegisterDashboard(url string, dashb dashboard.Dashboard) Dashica {
	d.log.Info().
		Str("url", url).
		Msg("Registering new dashboard")

	// Record the Explore view's URL so every dashboard's "Open in Explore"
	// affordance (and its redirect target) can find it, whatever the
	// registration order.
	if _, ok := dashb.(exploreView); ok {
		d.exploreBaseURL = url
	}

	page, err := dashb.CollectHandlers(
		&rendering.DashboardContext{
			MainMenu:          &d.dashboardGroups,
			CurrentHandlerUrl: url,
			Deps:              d.deps,
			ExploreBaseURL:    &d.exploreBaseURL,
		},
		d.handlerCollector.Nested(url),
	)
	if err != nil {
		d.log.Fatal().
			Err(err).
			Msg("Failed to register dashboard")
	}

	// add to the last dashboard group; fall back to URL if no title was set on the dashboard
	title := dashb.Title()
	if title == "" {
		title = url
	}
	d.dashboardGroups[len(d.dashboardGroups)-1].Entries = append(d.dashboardGroups[len(d.dashboardGroups)-1].Entries, rendering.MenuGroupEntry{
		Title:   title,
		Url:     url,
		Outline: widget.Outline(page.Widgets),
	})
	return d
}

func (d *DashicaImpl) isPathRegistered(urlPath string) bool {
	return d.handlerCollector.IsRegistered(urlPath)
}

var _ Dashica = (*DashicaImpl)(nil)
