package public

import "embed"

// FS contains Dashica-owned frontend assets built into public/dist.
//
//go:embed all:dist
var FS embed.FS
