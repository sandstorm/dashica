package logging

// customer_tenant
const (
	CustomerTenant  = "customer_tenant"
	CustomerProject = "customer_project"
	HostGroup       = "host_group"
	HostName        = "host_name"
	EventModule     = "event_module"
)

// event datasets
const (
	EventDataset = "event_dataset"

	// EventDataset_Dashica_App should be used for APPLICATION LEVEL LOGS
	// during request processing. If you manually write a log line, this is where you should place them.
	EventDataset_Dashica_App = "dashica.app"

	// EventDataset_Dashica_Http should be used for HTTP Request Logs (similar to Apache/NGINX Logs).
	// Should only be used in httpLogInterceptor.
	EventDataset_Dashica_Http                    = "dashica.http"
	EventDataset_Dashica_Alerting_Manager        = "dashica.alerting.manager"
	EventDataset_Dashica_Alerting_Evaluator      = "dashica.alerting.evaluator"
	EventDataset_Dashica_Alerting_BatchEvaluator = "dashica.alerting.batch_evaluator"
	// EventDataset_Dashica_Startup should only be used in main.go
	EventDataset_Dashica_Startup = "dashica.startup"
)

// custom log fields
const (
	Time_ms       = "event_duration_ms"
	ServerVersion = "serverVersion"
)
