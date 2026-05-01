package handler_collector

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/rs/zerolog"
)

type HandlerCollector interface {
	Handle(id string, handler http.Handler) error
	HandleRoot(handler http.Handler) error
	Nested(prefix string) HandlerCollector
	IsRegistered(path string) bool
}

func NewValidatingCollector(mux *http.ServeMux, logger zerolog.Logger) HandlerCollector {
	seen := make(map[string]bool)
	return &validatingCollectorImpl{
		seen:   &seen,
		mux:    mux,
		logger: logger,
		prefix: "",
	}
}

type validatingCollectorImpl struct {
	// seen is the list of seen handlers -> we want to SHARE the seen map with all nested collectors, hence a pointer
	seen *map[string]bool
	// mux is the mux to register handlers on (as pointer, to SHARE the same instance with all nested collectors)
	mux    *http.ServeMux
	logger zerolog.Logger
	prefix string
}

func (c validatingCollectorImpl) Handle(path string, handler http.Handler) error {
	if len(path) == 0 {
		return fmt.Errorf("empty path - if this is intended, use HandleRoot instead")
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}

	fullPath := c.prefix + path
	if (*c.seen)[fullPath] {
		return fmt.Errorf("duplicate route %s", fullPath)
	}
	c.logger.Info().
		Str("path", fullPath).
		Msg("Registering handler")

	(*c.seen)[fullPath] = true
	c.mux.Handle(fullPath, handler)
	return nil
}

func (c validatingCollectorImpl) HandleRoot(handler http.Handler) error {
	if (*c.seen)[c.prefix] {
		return fmt.Errorf("duplicate route %s", c.prefix)
	}
	c.logger.Info().
		Str("path", c.prefix).
		Msg("Registering handler")

	(*c.seen)[c.prefix] = true
	c.mux.Handle(c.prefix, handler)
	return nil
}

func (c validatingCollectorImpl) IsRegistered(path string) bool {
	return (*c.seen)[path]
}

func (c validatingCollectorImpl) Nested(prefix string) HandlerCollector {
	return &validatingCollectorImpl{
		seen:   c.seen,
		mux:    c.mux,
		logger: c.logger,
		prefix: c.prefix + prefix,
	}
}

var _ HandlerCollector = (*validatingCollectorImpl)(nil)
