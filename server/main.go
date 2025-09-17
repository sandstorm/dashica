package main

import (
	"context"
	"github.com/caddyserver/certmagic"
	"github.com/rs/zerolog"
	app "github.com/sandstorm/dashica"
	"github.com/sandstorm/dashica/server/alerting"
	"github.com/sandstorm/dashica/server/clickhouse"
	"github.com/sandstorm/dashica/server/core"
	"github.com/sandstorm/dashica/server/httpserver"
	"github.com/sandstorm/dashica/server/util/logging"
	"gopkg.in/natefinch/lumberjack.v2"
	"io/fs"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	// Profiling
	_ "net/http/pprof"
)

// Version is overridden on build via ldflags to the git branch and commit hash
var Version = "development"

func main() {
	// log.Printf is only allowed during startup, until Zerolog is set up.

	// --- Config loading ---

	// we need to start with config loading.
	config, err := core.LoadConfig(os.Getenv("APP_ENV"), false)

	if err != nil {
		// until zerolog is set up is the only location where a panic() call is allowed; everything else must use the logging library.
		panic(err)
	}
	core.PrintConfig(config)

	// --- Logger initialization ---

	zerolog.TimeFieldFormat = zerolog.TimeFormatUnixMicro // see clickhouse init-db.sql - monitoring.full_logs.timestamp
	zerolog.DurationFieldUnit = time.Millisecond          // see clickhouse init-db.sql - monitoring.full_logs.event_duration_ms
	zerolog.DurationFieldInteger = true                   // see clickhouse init-db.sql - monitoring.full_logs.event_duration_ms
	zerolog.TimestampFieldName = "timestamp"              // compatible with vector.dev

	var logger zerolog.Logger
	logWriter := &lumberjack.Logger{
		Filename: config.Log.FileName,
		// TODO make below configurable.
		MaxSize:    500, // megabytes
		MaxBackups: 3,
		MaxAge:     28, // days
	}

	if config.Log.ToStdout {
		logger = zerolog.New(zerolog.MultiLevelWriter(zerolog.ConsoleWriter{Out: os.Stderr}, logWriter)).With().
			Str(logging.CustomerTenant, "sandstorm").
			Str(logging.CustomerProject, "dashica").
			Str(logging.HostGroup, config.Log.HostGroup).
			Str(logging.HostName, config.Log.HostName).
			Str(logging.EventModule, "dashica").
			Str(logging.ServerVersion, Version).
			Timestamp().Logger()
	} else {
		logger = zerolog.New(zerolog.MultiLevelWriter(logWriter)).With().
			Str(logging.CustomerTenant, "sandstorm").
			Str(logging.CustomerProject, "dashica").
			Str(logging.HostGroup, config.Log.HostGroup).
			Str(logging.HostName, config.Log.HostName).
			Str(logging.EventModule, "dashica").
			Str(logging.ServerVersion, Version).
			Timestamp().Logger()
	}

	// NOTE: we also register the logger as the default context logger; this is used if for some reason no logger
	// with a request ID is stored in the context.
	zerolog.DefaultContextLogger = &logger

	startupLogger := logger.With().
		Str(logging.EventDataset, logging.EventDataset_Dashica_Startup).
		Logger()

	startupLogger.Info().
		Msg("Logging initialized. Starting to boot...")

	var fileSystem fs.ReadFileFS = app.EmbeddedFileSystem
	if config.DevMode {
		fileSystem = os.DirFS(".").(fs.ReadFileFS)
		if _, err = fs.Stat(fileSystem, "build/dashica"); os.IsNotExist(err) {
			startupLogger.Fatal().
				Msg("did NOT find build/dashica in working directory.")
		}
		startupLogger.Debug().
			Msg("Using live filesystem instead of the embedded one for hot-reloading of SQL files to work")
	}
	// --- App Startup ---
	timeProvider := core.NewRealTimeProvider()
	clickhouseClientManager := clickhouse.NewManager(config, logger)

	alertTargetClickhouseClient, err := clickhouseClientManager.GetClient("alert_storage")
	if err != nil {
		startupLogger.Fatal().
			Msg("did NOT find clickhouse 'alert_target' (needed for alert result storage) in dashica_config.yaml.")
	}
	alertResultStore := alerting.NewAlertResultStore(logger, alertTargetClickhouseClient)
	alertEvaluator := alerting.NewAlertEvaluator(logger, clickhouseClientManager, timeProvider)
	alertManager := alerting.NewAlertManager(config, logger, fileSystem, alertEvaluator, alertResultStore)

	// on startup, discover all alert definitions
	err = alertManager.DiscoverAlertDefinitions()
	if err != nil {
		startupLogger.Fatal().
			Err(err).
			Msg("errors discovering alert definitions")
	}

	httpHandler, err := httpserver.NewHttpHandler(config, logger, fileSystem, clickhouseClientManager, alertManager, alertEvaluator, alertResultStore)
	if err != nil {
		panic(err)
	}

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)

	go func() {
		select {
		case <-sig:
			os.Exit(0)
		}
	}()

	if !config.DevMode {
		// Start alert scheduler only in production
		go func() {
			err := alertManager.RunAlertScheduler()
			if err != nil {
				startupLogger.Fatal().
					Err(err).
					Msg("errors running alert scheduler")
			}
		}()
	}

	// --- Server startup + Letsencrypt ---
	if config.LetsEncrypt.Enabled {
		// for production, on the primary AND on the fallback.

		// read and agree to your CA's legal documents
		certmagic.DefaultACME.Agreed = true

		// provide an email address
		certmagic.DefaultACME.Email = config.LetsEncrypt.Email
		if config.LetsEncrypt.DevUseStagingCa {
			certmagic.DefaultACME.CA = certmagic.LetsEncryptStagingCA
		}
		if config.LetsEncrypt.DevCustomCa != "" {
			certmagic.DefaultACME.CA = config.LetsEncrypt.DevCustomCa
		}

		if config.LetsEncrypt.DevHttpPort != 0 {
			certmagic.HTTPPort = config.LetsEncrypt.DevHttpPort
		}
		if config.LetsEncrypt.DevHttpsPort != 0 {
			certmagic.HTTPSPort = config.LetsEncrypt.DevHttpsPort
		}

		certmagicManagedDomains := []string{config.LetsEncrypt.Domain}

		if len(config.LetsEncrypt.Domain) == 0 {
			startupLogger.Fatal().
				Msg("LETSENCRYPT_DOMAIN not set, but required when LETSENCRYPT_ENABLED=1")
		}

		if config.LetsEncrypt.DevCertRenewInterval != 0 {
			// DEV Mode for forcing certificate renewal on the PRIMARY (for trying out cert renewal every few seconds)
			t := time.NewTicker(config.LetsEncrypt.DevCertRenewInterval)
			go func() {
				certmagicConfig := certmagic.NewDefault()
				certmagicConfig.RenewalWindowRatio = 0.9
				for {
					// every X seconds...
					<-t.C
					startupLogger.Debug().
						Msg("(Dev): Trying to renew certificates")
					// do a renewal (only on the primary - on the fallback, certmagicManagedDomains is EMPTY)
					err := certmagicConfig.ManageSync(context.Background(), certmagicManagedDomains)
					if err != nil {
						startupLogger.Error().
							Err(err).
							Msg("(Dev): Renewal error")
					} else {
						startupLogger.Debug().
							Msg("(Dev): Renewal succeeded")
					}
				}
			}()
		}

		// for debugging and server-to-server connections to work, we need to deliver the SSL certificate no matter
		// what the hostname is.
		certmagic.Default.DefaultServerName = config.LetsEncrypt.Domain

		startupLogger.Info().
			Msg("Starting HTTP Server")

		err = certmagic.HTTPS(certmagicManagedDomains, httpHandler)

		if err != nil {
			startupLogger.Fatal().
				Err(err).
				Msg("failed to serve")
		}

	} else {
		startupLogger.Info().
			Msg("(DEV) Starting HTTP Server on 127.0.0.1:8080")

		err = http.ListenAndServe(
			":8080",
			httpHandler,
		)
		if err != nil {
			startupLogger.Fatal().
				Err(err).Msg("failed to serve")
		}
	}
}
