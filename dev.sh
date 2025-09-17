#!/bin/bash
############################## DEV_SCRIPT_MARKER ##############################
# This script is used to document and run recurring tasks in development.     #
#                                                                             #
# You can run your tasks using the script `./dev some-task`.                  #
# You can install the Sandstorm Dev Script Runner and run your tasks from any #
# nested folder using `dev some-task`.                                        #
# https://github.com/sandstorm/Sandstorm.DevScriptRunner                      #
###############################################################################

source ./dev_utilities.sh
source ./dev_tests.sh

set -e

######### TASKS #########

# Easy setup of the project
function setup() {
  _log_yellow "Setting up your project"
  which bw > /dev/null || brew install bitwarden-cli
  which jq > /dev/null || brew install jq
  which ack > /dev/null || brew install ack
  which kubectl > /dev/null || ( _log_red "missing kubectl, please install it" && exit 1 )
  [ -s "$NVM_DIR/nvm.sh" ] || (_log_red "missing nvm, please install it" && exit 1)
  pushd speedscope
    npm i
  popd
  _log_green "Done"
}

# Start the local stack connected to cloud.sandstorm.de
function up() {
  _log_yellow "loading nvm from $NVM_DIR/nvm.sh"
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

  # Generate config if missing
  [ -f app/dashica_config.yaml ] || generate_config

  docker compose up -d

  # Terminate existing session if it exists
  if tmux has-session -t dashica-dev 2>/dev/null; then
    tmux kill-session -t dashica-dev
  fi

  zellij --layout deployment/local-dev/up-layout.kdl

  _log_yellow "______________________________________________________"
  _log_yellow " to EXIT ZELLIJ next time, (the multi-pane setup), press CTRL+q"
  _log_yellow "______________________________________________________"
}

function up-observablehq() {
  _log_yellow "Starting dashboards"
  rm -f app/src/.observablehq/cache/data/envs.json
  cd app

  if [ -d "$HOME/.nvm" ]; then
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
    [ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion
    nvm use || nvm install
  fi

  npm install
  npm run dev
}

#function up-tunnel() {
#  kubectl port-forward -n ..... "$(kubectl get pods -n ..... -o=name)" 38123:8123 39000:9000
#}

#function up-tunnel-ssh() {
#  _log_yellow "Touch your Yubikey to connect to ..."
#  ssh TODO-your-ssh-here
#}

function up-speedscope(){
  pushd app/speedscope
    npm run serve
  popd
}

function up-server() {
  _log_yellow "______________________________________________________"
  _log_yellow " to EXIT ZELLIJ, (the multi-pane setup), press CTRL+q"
  _log_yellow "______________________________________________________"
  cd app
  go build -o build/dashica github.com/sandstorm/dashica/server
  exec ./build/dashica
}

# (re)creates the dashica_config.yaml file containing credentials
function generate_config() {
  _log_yellow "generating app/dashica_config.yaml file"
  _bw_require_unlocked

# TODO add Prod Clickhouse for profiling
  cat <<EOF > app/dashica_config.yaml

# !!! THIS FILE IS IN .gitignore
# !!! BECAUSE IT CONTAINS SENSITIVE PWs

clickhouse:
  alert_storage:
    url: http://127.0.0.1:28123
    user: admin
    password: password
    database: default
    query_file_patterns:
      - /content/__testing

  profiling_local_dev:
    url: http://127.0.0.1:8123
    user: user
    password: password
    database: default
    query_file_patterns:
      - /content/templates/profiling


log:
  to_stdout: true
dev_mode: true

EOF
}

function clickhouse-client-docker-local() {
  local DB="monitoring"
  local USER="admin"
  local PASS="password"

  exec clickhouse client --host localhost --port 29001 --database "$DB" --user "$USER" --password "$PASS"
}

# Generate Readme
function gen-readme() {
  gomplate -f README.template.md -o README.md
}

_log_green "---------------------------- RUNNING TASK: $1 ----------------------------"

# THIS NEEDS TO BE LAST!!!
# this will run your tasks
"$@"
