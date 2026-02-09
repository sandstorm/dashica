# Sample Data for Dev Server

This directory contains SQL scripts that initialize ClickHouse with sample data for the Dashica dev server examples.

## Tables Created

### http_logs
Web server access logs with:
- 50,000 records over the last 7 days
- Multiple hostnames, HTTP methods, paths
- Status codes distributed across 2xx, 3xx, 4xx, 5xx
- Response times and byte sizes
- Used in: TimeBar, BarVertical, BarHorizontal examples

### metrics
System metrics with:
- 10,000 records over the last 24 hours
- CPU, memory, disk usage metrics
- Requests per minute and error rates
- Tagged with host and environment
- Used in: Stats, TimeBar examples

### events
User and system events with:
- 100,000 records over the last 30 days
- User actions, system events, errors, purchases
- User IDs and session data
- Used in: TimeBar, heatmap examples

### service_health
Service health check results with:
- ~2,000 records over the last 7 days (every 5 minutes)
- Multiple microservices
- Status: healthy, degraded, down
- Response times
- Used in: TimeHeatmap, TimeHeatmapOrdinal examples

## Automatic Setup

These scripts are automatically executed when you start the Docker Compose stack:

```bash
docker-compose -f docker-compose.dev.yml up -d
```

The initialization happens only once when the volume is first created.

## Manual Reset

To reset the database and reload sample data:

```bash
# Stop and remove the containers and volumes
docker-compose -f docker-compose.dev.yml down -v

# Start fresh (this will re-run initialization scripts)
docker-compose -f docker-compose.dev.yml up -d
```

## Querying the Data

### Using clickhouse-client

```bash
# Connect to the running container
docker exec -it dashica-dev-clickhouse clickhouse-client

# Run queries
SELECT count() FROM http_logs;
SELECT statusGroup, count() FROM http_logs GROUP BY statusGroup;
```

### Using HTTP interface

Open http://localhost:8123/play in your browser for the web UI.

### From the Dev Server

The dev server will automatically connect to this ClickHouse instance when using the example configuration.

## Customizing Data

To add your own sample data:

1. Create a new SQL file in `init-scripts/` (e.g., `03_my_custom_data.sql`)
2. Files are executed in alphanumeric order
3. Restart the stack to apply: `docker-compose -f docker-compose.dev.yml restart`

## Data Volume

Sample data is stored in a Docker volume named `dashica-dev-clickhouse-data`. This persists between restarts but can be deleted with:

```bash
docker-compose -f docker-compose.dev.yml down -v
```
