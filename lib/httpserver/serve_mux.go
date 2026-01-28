package httpserver

import (
	"net/http"
	"strings"
)

/*func NewHttpHandler(config *core.AppConfig, logger zerolog.Logger, fileSystem fs.ReadFileFS, clickhouseClientManager *clickhouse.Manager, alertManager *alerting.AlertManager, alertEvaluator *alerting.AlertEvaluator, alertResultStore *alerting.AlertResultStore) (http.Handler, error) {
	mux := http.NewServeMux()

	mux.Handle("/api/speedscopeQuery", ErrorHandler(speedscopeQueryHandler{clickhouseClientManager: clickhouseClientManager, logger: logger, fileSystem: fileSystem}))
	mux.Handle("/api/query-alerts", ErrorHandler(queryAlertsHandler{clickhouseClientManager: clickhouseClientManager, alertManager: alertManager, alertResultStore: alertResultStore, logger: logger, devMode: config.DevMode}))
	mux.Handle("/api/query-alert-chart", ErrorHandler(queryAlertChartHandler{clickhouseClientManager: clickhouseClientManager, alertManager: alertManager, logger: logger}))
	mux.Handle("/api/schema", ErrorHandler(schemaHandler{clickhouseClientManager: clickhouseClientManager}))
	mux.Handle("/api/showTableStructure", ErrorHandler(showTableStructureHandler{clickhouseClientManager: clickhouseClientManager}))

	if config.DevMode {
		// Calculate alerts
		batchEvaluator := alerting.NewBatchEvaluator(logger, alertManager)
		mux.Handle("/api/debug-calculate-alerts", ErrorHandler(debugCalculateAlertsHandler{batchEvaluator: batchEvaluator, alertResultStore: alertResultStore}))

		// Observable Framework Reverse proxy (to prevent CORS) towards the Observable Framework server (=hot reloading of notebooks during dev)
		uSpeedscope, err := url.Parse("http://127.0.0.1:8000/")
		if err != nil {
			return nil, fmt.Errorf("parsing URL http://127.0.0.1:8000: %w", err)
		}

		mux.Handle("/speedscope/", httputil.NewSingleHostReverseProxy(uSpeedscope))

		u, err := url.Parse("http://127.0.0.1:3000")
		if err != nil {
			return nil, fmt.Errorf("parsing URL http://127.0.0.1:3000: %w", err)
		}

		mux.Handle("/", httputil.NewSingleHostReverseProxy(u))

	} else {
		var publicFS, _ = fs.Sub(fileSystem, "public")
		mux.Handle("/", noDirListing(http.FileServerFS(publicFS)))
	}

	handler := http.Handler(mux)

	return handler, nil
}*/

func noDirListing(h http.Handler) http.HandlerFunc {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" && strings.HasSuffix(r.URL.Path, "/") && r.URL.Path != "/speedscope/" {
			http.NotFound(w, r)
			return
		}
		h.ServeHTTP(w, r)
	})
}

type HandlerWithError interface {
	ServeHTTP(http.ResponseWriter, *http.Request) error
}

func ErrorHandler(handler HandlerWithError) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := handler.ServeHTTP(w, r); err != nil {
			code := http.StatusInternalServerError
			http.Error(w, "ERROR: "+err.Error(), code)
		}
	})
}
