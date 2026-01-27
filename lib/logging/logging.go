package logging

const (
	EventModule = "event_module"
)

// event datasets
const (
	EventDataset = "event_dataset"

	EventDataset_Falco_Startup = "falco.startup"
	EventDataset_Falco_Ipc     = "falco.ipc"
	// logs if active response was disabled or enabled
	EventDataset_Falco_ActiveResponse = "falco.activeResponse"

	// If event received -> only logged EXACTLY ONCE per event
	EventDataset_Falco_Event = "falco.event"
)
