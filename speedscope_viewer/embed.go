// Package speedscope_viewer embeds the built Speedscope flame-graph viewer assets
// (HTML/JS/CSS/fonts produced by app/speedscope's build-release script) so they can
// be served from within a Go binary without any external file dependency.
//
// The dist/ subdirectory is populated by dashica-src/frontendBuild.mjs invoking
// app/speedscope's tsx scripts/build-release.ts --protocol http build. A placeholder
// .gitkeep keeps the directory present so this package compiles before the first build.
package speedscope_viewer

import "embed"

//go:embed all:dist
var FS embed.FS
