package dashica

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/sandstorm/dashica/lib/components/layout"
	"github.com/sandstorm/dashica/lib/dashboard"
	"github.com/sandstorm/dashica/lib/dashboard/widget"
)

// ScanAndRegisterMarkdownDashboards scans a base directory and automatically
// creates dashboard groups for each folder and registers markdown files as dashboards.
//
// Parameters:
//   - d: the dashica instance
//   - baseDir: the base directory to scan (e.g., "src")
//   - pathPrefix: optional URL path prefix (e.g., "/dashboards")
//
// Example directory structure:
//
//	src/
//	  falco/
//	    alerts.md
//	    overview.md
//	  oekokiste/
//	    summary.md
//
// This will create:
//   - Group "Falco" with dashboards at /falco/alerts and /falco/overview
//   - Group "Oekokiste" with dashboard at /oekokiste/summary
func (d *DashicaImpl) ScanAndRegisterMarkdownDashboards(baseDir string, pathPrefix string) Dashica {
	// Get all subdirectories in the base directory
	entries, err := os.ReadDir(baseDir)
	if err != nil {
		d.log.Fatal().
			Str("baseDir", baseDir).
			Str("pathPrefix", pathPrefix).
			Err(err).
			Msg("Failed to read dashboard directory")
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		groupName := entry.Name()
		groupDir := filepath.Join(baseDir, groupName)

		// Clean up group name for display (remove prefixes, capitalize)
		displayGroupName := formatGroupName(groupName)

		// Register the dashboard group
		d.RegisterDashboardGroup(displayGroupName)

		// Scan for markdown files in this directory
		err := filepath.WalkDir(groupDir, func(path string, info os.DirEntry, err error) error {
			if err != nil {
				return err
			}

			// Skip directories and non-markdown files
			if info.IsDir() || !strings.HasSuffix(strings.ToLower(info.Name()), ".md") {
				return nil
			}

			// Create dashboard path
			relPath, err := filepath.Rel(baseDir, path)
			if err != nil {
				return err
			}

			// Convert file path to URL path
			urlPath := filepath.ToSlash(relPath)
			urlPath = strings.TrimSuffix(urlPath, ".md")
			urlPath = pathPrefix + "/" + urlPath

			// Skip if this path is already registered (e.g. by a Go dashboard)
			if d.isPathRegistered(urlPath) {
				return nil
			}

			// Register the dashboard
			d.RegisterDashboard(urlPath, dashboard.New().
				WithLayout(layout.DefaultPage).
				Widget(widget.NewLegacyMarkdown().
					File(path),
				),
			)

			return nil
		})

		if err != nil {
			d.log.Fatal().
				Str("baseDir", baseDir).
				Err(err).
				Msg("Failed read dashboard files")
		}
	}

	return d
}

// formatGroupName cleans up a directory name for display as a group name.
// Examples:
//   - "p_oekokiste" -> "Oekokiste"
//   - "falco" -> "Falco"
//   - "my_project" -> "My Project"
func formatGroupName(dirName string) string {
	// Remove common prefixes
	name := strings.TrimPrefix(dirName, "p_")
	name = strings.TrimPrefix(name, "project_")

	// Replace underscores with spaces
	name = strings.ReplaceAll(name, "_", " ")

	// Capitalize first letter of each word
	words := strings.Fields(name)
	for i, word := range words {
		if len(word) > 0 {
			words[i] = strings.ToUpper(word[:1]) + word[1:]
		}
	}

	return strings.Join(words, " ")
}
