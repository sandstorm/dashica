package clickhouse

import (
	"fmt"
	"maps"
	"slices"
	"sync"

	"github.com/rs/zerolog"
	"github.com/sandstorm/dashica/lib/config"
)

// ClientManager holds a Client per ClickHouse connection of dashica_config, each made on first use (GetClient).
type ClientManager struct {
	config  *config.Config
	clients map[string]*Client
	// mutex protecting clients map
	mu     sync.RWMutex
	logger zerolog.Logger
}

// NewClientManager creates a new Clickhouse client manager
func NewClientManager(config *config.Config, logger zerolog.Logger) *ClientManager {
	return &ClientManager{
		config:  config,
		clients: make(map[string]*Client),
		logger:  logger,
	}
}

// GetClient returns a client for the specified server ID
func (cm *ClientManager) GetClient(serverId string) (*Client, error) {
	cm.mu.RLock()
	client, exists := cm.clients[serverId]
	cm.mu.RUnlock()

	if exists {
		return client, nil
	}

	cm.mu.Lock()
	defer cm.mu.Unlock()

	// Check again in case another goroutine created the client while we were waiting for the lock
	client, exists = cm.clients[serverId]
	if exists {
		return client, nil
	}

	serverConfig, found := cm.config.ClickHouse[serverId]
	if !found {
		return nil, fmt.Errorf("server '%s' not found in config", serverId)
	}

	client = NewClient(&serverConfig, serverId, cm.logger)
	cm.clients[serverId] = client
	return client, nil
}

// Connections are the names of the ClickHouse connections dashica_config names (`clickhouse.<name>`), sorted.
func (cm *ClientManager) Connections() []string {
	return slices.Sorted(maps.Keys(cm.config.ClickHouse))
}
