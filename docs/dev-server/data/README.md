# Sample Data for Dev Server

This directory contains SQL scripts that initialize ClickHouse with sample data for the Dashica dev server examples.

## Tables Created

### http_logs
Web server access logs with **realistic day/night traffic patterns**:
- **~5.5 million records** over 37 days (~150,000 requests/day)
- **Day/night variation**:
  - Night (23:00-06:00): 1-3 requests/minute
  - Morning (07-09:00): 5-8 requests/minute
  - **Peak hours (10-11:00, 14-15:00)**: 10-15 requests/minute
  - Midday (12-13:00): 7-10 requests/minute
  - Evening (16-22:00): 6-9 requests/minute
- Multiple hostnames, HTTP methods, paths
- Status codes distributed across 2xx, 3xx, 4xx, 5xx
- Response times and byte sizes
- Used in: TimeBar, BarVertical, BarHorizontal examples

### metrics
System metrics with **load-based patterns**:
- **~115,000 records** over 8 days (10 servers, 5 metrics each, per minute)
- **Time-based patterns**:
  - CPU usage: 10-30% at night, 50-90% during business hours
  - Memory usage: 50-70% baseline, 60-80% during peak
  - Disk usage: gradually increases over time
  - Requests per minute: follows traffic patterns
  - Error rate: typically low (<3%), occasional spikes
- CPU, memory, disk usage metrics
- Requests per minute and error rates
- Tagged with host and environment
- Used in: Stats, TimeBar examples

### events
User and system events with **realistic user activity patterns**:
- **~7.4 million records** over 37 days (~200,000 events/day)
- **Day/night user activity**:
  - Night (00-06:00): 2-5 events/minute
  - Morning (07-09:00): 10-15 events/minute
  - **Peak hours (10-16:00)**: 15-25 events/minute
  - Evening (17-23:00): 8-12 events/minute
- User actions, system events, errors, purchases
- 5,000 unique users (increased from 1,000)
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
