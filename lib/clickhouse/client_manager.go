package clickhouse

import (
	"fmt"
	"sync"

	"github.com/rs/zerolog"
	"github.com/sandstorm/dashica/lib/config"
)

// Manager manages multiple Clickhouse clients
type Manager struct {
	config  *config.Config
	clients map[string]*Client
	// mutex protecting clients map
	mu     sync.RWMutex
	logger zerolog.Logger
}

// NewManager creates a new Clickhouse client manager
func NewManager(config *config.Config, logger zerolog.Logger) *Manager {
	return &Manager{
		config:  config,
		clients: make(map[string]*Client),
		logger:  logger,
	}
}

// GetClient returns a client for the specified server ID
func (cm *Manager) GetClient(serverId string) (*Client, error) {
	cm.mu.RLock()
	client, exists := cm.clients[serverId]
	cm.mu.RUnlock()

	if exists {
		return client, nil
	}

	// If client doesn't exist, create it
	cm.mu.Lock()
	defer cm.mu.Unlock()

	// Check again in case another goroutine created the client while we were waiting for the lock
	client, exists = cm.clients[serverId]
	if exists {
		return client, nil
	}

	// Get server config
	serverConfig, found := cm.config.ClickHouse[serverId]
	if !found {
		return nil, fmt.Errorf("server '%s' not found in config", serverId)
	}

	// Create new client
	client = NewClient(&serverConfig, serverId, cm.logger)
	cm.clients[serverId] = client
	return client, nil
}
