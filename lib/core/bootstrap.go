package core

import (
	"github.com/sandstorm/dashica/lib/clickhouse"
	"github.com/sandstorm/dashica/server/core"
)

type BootstrapDeps struct {
	TimeProvider core.TimeProvider
}

func Boot(config, logger) *BootstrapDeps {
	return &BootstrapDeps{

		ClickhouseClientManager: clickhouse.NewManager(config, logger)
	}
}
