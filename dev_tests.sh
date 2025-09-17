#!/bin/bash

set -e

# runs all tests on the local machine
function tests_run_all() {
    _log_yellow "Starting clickhouse"
    docker compose up -d

    _log_yellow "Starting tests"
    (cd app && go test -cover ./...)
}

# runs a single test on the local machine, eg dev tests_run_single TestFoo_Bar
function tests_run_single() {
  local case=$1
  if [ -z "$case" ]; then
    _log_red "Please provide a test case to run as first argument"
    echo "Example: tests_run_single TestFoo_Bar"
    return 1
  fi

  _log_yellow "Starting clickhouse"
  docker compose up -d

  cd app
  local file=$(ack -l "$case" | head -n 1)
  local parent_dir=$(dirname $file)
  go test -trace trace.out -v -run "$case" "./$parent_dir"
}

# Runs specific tests for a go package by a given regex pattern
# Example:
#   `dev tests_run_pattern '.*' ...`
#   --> will run all tests inside the germany package.
function tests_run_pattern() {
  local case_regex=$1
  if [ -z "$case_regex" ]; then
    _log_red "Please provide a test case regex pattern to run as first argument"
    echo "Example: '.*' - will match all tests"
    return 1
  fi

  package=$2
  if [ -z "$package" ]; then
    _log_red "Please provide a package to run as second argument"
    echo "Example: 'github.com/sandstorm/dashica/foo/bar'"
    return 1
  fi

  _log_yellow "Starting clickhouse"
    docker compose up -d

  cd app
  go test -trace trace.out -v -run "$case_regex" $package
}

# runs all tests in the CI pipeline
function tests_run_all_ci() {
  _log_yellow "Starting tests"
  export APP_ENV=testing_ci
  (cd app && go test -cover ./...)
}

# waits at most $3 seconds for the port $1:$2 to become open
# the timeout $3 defaults to 30 seconds
function tests_wait_for_port() {
  local host="$1"
  local port="$2"
  local before=$(date +%s)
  local timeout=${3:-30}
  until (nc -zw 2 "$host" "$port"); do
    local now=$(date +%s)
    local duration="$((now - before))"
    if [ "$duration" -ge "$timeout" ]; then
      echo "Timeout after waiting $duration seconds for $host:$port …"
      return 1
    fi
    echo "Waiting for $host:$port …";
    sleep 1;
  done
  echo "$host:$port is available"
}
