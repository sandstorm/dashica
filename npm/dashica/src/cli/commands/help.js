export default async function help({ command }) {
    if (command) {
        // Show help for specific command
        const helpTexts = {
            build: `
Usage: dashica build [options]

Build your dashboard for production.

Options:
  --output, -o <dir>    Output directory (default: dist)
  --verbose, -v         Verbose output
`,
            preview: `
Usage: dashica preview [options]

Preview your built dashboard.

Options:
  --port, -p <port>     Port number (default: 3000)
  --host <host>         Host (default: localhost)
`,
            dev: `
Usage: dashica dev [options]

Start development server.

Options:
  --port, -p <port>     Port number (default: 3000)
`,
        };

        console.log(helpTexts[command] || `No help available for: ${command}`);
        return;
    }

    // General help
    console.log(`
dashica - A code-first monitoring dashboard

Usage: dashica <command> [options]

Commands:
  build      Build dashboard for production
  preview    Preview built dashboard
  dev        Start development server
  help       Show this help

Options:
  --version, -v    Show version
  --help, -h       Show help

Examples:
  dashica build --output dist
  dashica dev --port 4000
  dashica help build
`);
}