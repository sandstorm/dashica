package docs

import (
	"github.com/sandstorm/dashica/lib/components/layout"
	"github.com/sandstorm/dashica/lib/dashboard"
	"github.com/sandstorm/dashica/lib/dashboard/widget"
)

func Deployment() dashboard.Dashboard {
	return dashboard.New().
		WithLayout(layout.DocsPage).
		Widget(
			widget.NewMarkdown().
				Title("Building & Deployment").
				Content(`
# Building & Deployment

Dashica consists of two parts:
- The server (written in Golang)
- The frontend (Node.js / based on Observable Framework)

There are three ways to build Dashica, explained below.

## Option 1: Build Everything with Docker (Recommended for Production)

This is the easiest way to build both the frontend and backend in one step.

**Prerequisites:**
- Docker

**Build:**

` + "```bash" + `
docker build -t dashica:latest .
` + "```" + `

The Dockerfile:
1. Builds the frontend using Node.js
2. Builds the Go server
3. Creates a minimal production image with just the compiled binary and frontend assets

**Run:**

` + "```bash" + `
docker run -p 8080:8080 \
  -v $(pwd)/dashica_config.yaml:/app/dashica_config.yaml \
  dashica:latest
` + "```" + `

## Option 2: Build Locally (Development)

Build the frontend and backend separately on your local machine.

**Prerequisites:**
- Node.js 18+ and npm
- Go 1.21+
- mise (optional, for version management)

**Step 1: Build the Frontend**

` + "```bash" + `
# Install dependencies
npm install

# Build frontend assets
npm run build
` + "```" + `

This creates the ` + "`public/dist/`" + ` directory with:
- Bundled JavaScript
- Compiled CSS
- Optimized assets

**Step 2: Build the Go Server**

` + "```bash" + `
# Using mise (recommended)
mise exec go -- go build -o dashica

# Or with system Go
go build -o dashica
` + "```" + `

**Step 3: Run**

` + "```bash" + `
./dashica
` + "```" + `

The server will:
- Load ` + "`dashica_config.yaml`" + ` from the current directory
- Serve the frontend from ` + "`public/dist/`" + `
- Listen on port 8080 (or ` + "`$PORT`" + ` if set)

## Option 3: Development Mode with Live Reload

For active development, use live reload for both frontend and backend.

**Terminal 1: Frontend with Live Reload**

` + "```bash" + `
npm run dev
` + "```" + `

This runs Observable Framework in dev mode with hot module reloading.

**Terminal 2: Backend with Live Reload**

` + "```bash" + `
# Option A: Using mise task
mise run watch

# Option B: Using air (install: go install github.com/cosmtrek/air@latest)
air
` + "```" + `

The backend will restart automatically when Go files change.

## Configuration

### Environment Variables

` + "```bash" + `
export PORT=8080                # Server port (default: 8080)
export APP_ENV=production       # Environment (loads dashica_config.<env>.yaml)
` + "```" + `

### Configuration File

Create ` + "`dashica_config.yaml`" + ` (or ` + "`dashica_config.<env>.yaml`" + `):

` + "```yaml" + `
clickhouse:
  url: "http://localhost:8123"
  username: "default"
  password: ""
  database: "default"

logging:
  level: "info"
  format: "json"

alerting:
  enabled: false
  check_interval: "5m"
` + "```" + `

## Deployment Strategies

### Docker Compose

` + "```yaml" + `
version: '3.8'

services:
  dashica:
    image: dashica:latest
    ports:
      - "8080:8080"
    volumes:
      - ./dashica_config.yaml:/app/dashica_config.yaml:ro
    environment:
      - APP_ENV=production
    restart: unless-stopped

  clickhouse:
    image: clickhouse/clickhouse-server:latest
    ports:
      - "8123:8123"
      - "9000:9000"
    volumes:
      - clickhouse-data:/var/lib/clickhouse
    restart: unless-stopped

volumes:
  clickhouse-data:
` + "```" + `

### Kubernetes

**Deployment:**

` + "```yaml" + `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: dashica
spec:
  replicas: 2
  selector:
    matchLabels:
      app: dashica
  template:
    metadata:
      labels:
        app: dashica
    spec:
      containers:
      - name: dashica
        image: dashica:latest
        ports:
        - containerPort: 8080
        env:
        - name: APP_ENV
          value: production
        volumeMounts:
        - name: config
          mountPath: /app/dashica_config.yaml
          subPath: dashica_config.yaml
      volumes:
      - name: config
        configMap:
          name: dashica-config
` + "```" + `

**Service:**

` + "```yaml" + `
apiVersion: v1
kind: Service
metadata:
  name: dashica
spec:
  selector:
    app: dashica
  ports:
  - protocol: TCP
    port: 80
    targetPort: 8080
  type: LoadBalancer
` + "```" + `

**ConfigMap:**

` + "```yaml" + `
apiVersion: v1
kind: ConfigMap
metadata:
  name: dashica-config
data:
  dashica_config.yaml: |
    clickhouse:
      url: "http://clickhouse:8123"
      username: "default"
      password: ""
      database: "production"
    logging:
      level: "info"
` + "```" + `

### Systemd Service

` + "```ini" + `
[Unit]
Description=Dashica Dashboard
After=network.target

[Service]
Type=simple
User=dashica
WorkingDirectory=/opt/dashica
ExecStart=/opt/dashica/dashica
Restart=on-failure
Environment="PORT=8080"
Environment="APP_ENV=production"

[Install]
WantedBy=multi-user.target
` + "```" + `

## Security Considerations

1. **ClickHouse Access:**
   - Use read-only database user for Dashica
   - Restrict network access to ClickHouse
   - Use TLS for ClickHouse connections in production

2. **Authentication:**
   - Place Dashica behind a reverse proxy with authentication
   - Use VPN or IP whitelisting for sensitive data
   - Consider implementing OAuth2/OIDC

3. **Configuration:**
   - Never commit ` + "`dashica_config.yaml`" + ` with passwords to Git
   - Use environment variables or secrets management
   - Restrict file permissions on config files

## Performance Tips

1. **Frontend:**
   - Enable gzip/brotli compression in reverse proxy
   - Set appropriate cache headers for static assets
   - Use CDN for static assets if needed

2. **Backend:**
   - Set appropriate ` + "`GOMAXPROCS`" + ` for your environment
   - Monitor memory usage and adjust container limits
   - Use connection pooling for ClickHouse

3. **ClickHouse:**
   - Create appropriate indexes on queried columns
   - Use materialized views for complex aggregations
   - Optimize table engines and partitioning

## Monitoring

Monitor these metrics:

- HTTP response times
- ClickHouse query duration
- Error rates
- Memory usage
- Active connections

## Next Steps

- [Alerting](/docs/alerting) - Set up alerts
- [Usage Philosophy](/docs/usage-philosophy) - Understand Dashica's design
`),
		)
}
