#!/bin/bash
############################## DEV_SCRIPT_MARKER ##############################
# This script is used to document and run recurring tasks in development.     #
#                                                                             #
# You can run your tasks using the script `./dev some-task`.                  #
# You can install the Sandstorm Dev Script Runner and run your tasks from any #
# nested folder using `dev some-task`.                                        #
# https://github.com/sandstorm/Sandstorm.DevScriptRunner                      #
###############################################################################

source ./dev_tests.sh

set -e

GO_FLAGS=(-trimpath -ldflags "-s -w")
DIST_DIR="dist"
BIN_DIR="build"
MAIN_PKG="./cmd/dashica-server"

# Centralized platform targets used by build-all and clean
# Format per entry: "GOOS GOARCH OUTDIR OUT"
TARGETS=(
  "darwin arm64 npm/@dashica/darwin-arm64/bin dashica-server"
  "darwin amd64 npm/@dashica/darwin-x64/bin dashica-server"
  "linux arm npm/@dashica/linux-arm/bin dashica-server"
  "linux arm64 npm/@dashica/linux-arm64/bin dashica-server"
  "linux 386 npm/@dashica/linux-ia32/bin dashica-server"
  "linux amd64 npm/@dashica/linux-x64/bin dashica-server"
  "windows arm64 npm/@dashica/win32-arm64 dashica-server.exe"
  "windows 386 npm/@dashica/win32-ia32 dashica-server.exe"
  "windows amd64 npm/@dashica/win32-x64 dashica-server.exe"
)

######### TASKS #########

# Easy setup of the project
function setup() {
  _log_yellow "Setting up your project"
  which gomplate > /dev/null || brew install gomplate
  npm i
  _log_green "Done. To get started:"
  _log_green "  cd docs/"
  _log_green "  npm run preview"
  _log_green "http://127.0.0.1:8080"
}

# Build Go server for current platform
function build-server() {
  _log_yellow "Building dashica-server for current platform"
  CGO_ENABLED=0 go build -C ./server "${GO_FLAGS[@]}" -o "$BIN_DIR/dashica-server" "$MAIN_PKG"
  _log_green "Built: ./server/$BIN_DIR/dashica-server"
}

# Build Go server for current platform
function build-server-embedded() {
  _log_yellow "Building dashica-server with embedded files from dist/ for current platform"
  CGO_ENABLED=0 go build -C ./server "${GO_FLAGS[@]}" -tags embed -o "$BIN_DIR/dashica-server" "$MAIN_PKG"
  _log_green "Built: ./server/$BIN_DIR/dashica-server"
}

# Cross-compile for common platforms into npm/@dashica outDir layout
function build-all() {
  _log_yellow "Building platform binaries into npm/@dashica/*"
  for t in "${TARGETS[@]}"; do
    read -r GOOS GOARCH OUTDIR OUT <<< "$t"
    mkdir -p "$OUTDIR"
    _log_yellow "→ $GOOS/$GOARCH → $OUTDIR/$OUT"
    CGO_ENABLED=0 GOOS="$GOOS" GOARCH="$GOARCH" go build -C ./server "${GO_FLAGS[@]}" -o "../$OUTDIR/$OUT" "$MAIN_PKG"
  done
  _log_green "All artifacts written to npm/@dashica/"
}

# Clean build artifacts and caches
function clean() {
  _log_yellow "Cleaning build artifacts, npm/@dashica platform outputs, and Go caches"
  # Local server binary
  rm -rf "$DIST_DIR" "$BIN_DIR"

  # Platform-specific build outputs (from build-all) using shared TARGETS
  for t in "${TARGETS[@]}"; do
    read -r GOOS GOARCH OUTDIR OUT <<< "$t"
    if [[ "$OUT" == *.exe ]]; then
      rm -f "$OUTDIR/$OUT"
    else
      rm -rf "$OUTDIR"
    fi
  done

  # Go caches
  pushd server >/dev/null || return 0
  go clean -cache
  go clean -testcache
  popd >/dev/null
  _log_green "Clean complete"
}

# Generate Readme
function gen-readme() {
  gomplate -f README.template.md -o README.md
}

####### Utilities #######
_log_green() {
  printf "\033[0;32m%s\033[0m\n" "${1}"
}
_log_yellow() {
  printf "\033[1;33m%s\033[0m\n" "${1}"
}
_log_red() {
  printf "\033[0;31m%s\033[0m\n" "${1}"
}

_log_green "---------------------------- RUNNING TASK: $1 ----------------------------"

# THIS NEEDS TO BE LAST!!!
# this will run your tasks
"$@"
