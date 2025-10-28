# Dashicy


# Development

## Development Setup

Prerequisites:

- Docker Compose

Get started:

```bash
# at root of repo:
dev setup

# follow instructions
```

## Running Tests

```bash

# run all unit tests
dev tests_run_all
```

The test setup is a bit intricate, as shown by the image below:

- The main idea is to base the tests on **real incidents**. For data privacy reasons, we only extract the **event
  timestamps**
  from the incident and not the event payload. This usually is enough because alerts normally are based on counting
  events in
  a timeframe.
- there exists tooling for **downloading incident data** from prod - described
  at http://127.0.0.1:8080/content/__testing/test-data
  (which is the rendered version of [test-data.md](app/client/content/__testing/test-data.md)). This is **ALSO used for
  visualizing** the shape and volume of the data - extremely helpful for writing and debugging tests.

```
┌──────────────────────────────────┐                                                                                                           
│          E2E testcases           │───────────────────────────────┐                                                                           
└──────────────────────────────────┘                      load and │                                                                           
                  │use                                     execute ▼                                                                           
                  ▼                              ┌──────────────────────────────────┐                                                          
┌──────────────────────────────────┐             │    alerts.yaml + SQL queries     │                                    _____ ___ ___ _____   
│   dashica_config_testing.yaml    │             │  server/alerting/test_fixtures/  │─ ─ ─ ┐ builds on fixture          |_   _| __/ __|_   _|  
└──────────────────────────────────┘             └──────────────────────────────────┘        data for the                 | | | _|\__ \ | |    
                  │default: use                                                            │ different testcases          |_| |___|___/ |_|    
                  │the local DB                                                            ▼                                                   
                  ▼                                                ┌───────────────────────────────────────────────┐                           
┌──────────────────────────────────┐          imported via         │                   FIXTURES                    │                           
│            CLICKHOUSE            │  /docker_entrypoint_initdb.d  │deployment/local_dev/clickhouse/test_prod_dumps│                           
│        docker-compose.yml        │◀──────────────────────────────│                  /*.parquet                   ╠═════════════════════════
└──────────────────────────────────┘                               │  contains event timestamps of real incidents  │                           
                  ▲                                                └───────────────────────────────────────────────┘       ___  _____   __     
                  │ alert_target:                                                          ▲                              |   \| __\ \ / /     
                  │ use the local DB                                              visualize│                              | |) | _| \ V /      
┌──────────────────────────────────┐                         ┌──────────────────────────────────────────────────────────┐ |___/|___| \_/       
│       dashica_config.yaml        │                         │     Dev Dashboard for visualizing the fixtures (with     │                      
└──────────────────────────────────┘                         │  explanations); helpful for test creation and debugging  │                      
                                                             │    http://127.0.0.1:8080/content/__testing/test-data     │                      
                                                             └──────────────────────────────────────────────────────────┘                      
```

## Development Cookbook / Tips and Tricks

In this section, we collect various tips and tricks for specific situations.

### Starting from Scratch again / dropping all data in the container

```bash
# remove all containers; reset database state
docker compose down -v -t0

# remove all untracked files (dry run - does NOT delete anything)
git clean -X -n
# remove all untracked files
git clean -X -f
```

### Goreleaser Debugging

```bash
cd server
goreleaser release --snapshot --clean  --verbose

docker run --rm --name dashica-dev -it --entrypoint /bin/bash ghcr.io/sandstorm/dashica:latest-arm64

docker run --rm -it ghcr.io/sandstorm/dashica:latest-arm64

```

# Thanks to

**ESBuild** - we copied their go/node.js binary build setup + distribution through NPM and adjusted that.