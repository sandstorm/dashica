#!/bin/bash
############################## DEV_SCRIPT_MARKER ##############################
# This script is used to document and run recurring tasks in development.     #
#                                                                             #
# You can run your tasks using the script `./dev some-task`.                  #
# You can install the Sandstorm Dev Script Runner and run your tasks from any #
# nested folder using `dev some-task`.                                        #
# https://github.com/sandstorm/Sandstorm.DevScriptRunner                      #
###############################################################################

set -e

######### TASKS #########

# Easy setup of the project
function setup() {
  _log_yellow "Setting up your project"
  which zellij > /dev/null || brew install zellij
  # If you want to use NVM (Node Version Manager), comment in the next line.
  # [ -s "$NVM_DIR/nvm.sh" ] || (_log_red "missing nvm, please install it" && exit 1)

  _log_green "Done"
}

# Start the local stack
function up() {
  # If you want to use NVM (Node Version Manager), comment in the next two lines.
  #_log_yellow "loading nvm from $NVM_DIR/nvm.sh"
  #[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

  # Generate config if missing
  # [ -f app/dashica_config.yaml ] || generate_config

  docker compose up -d

  zellij --layout dev-layout.kdl

  _log_yellow "______________________________________________________"
  _log_yellow " to EXIT ZELLIJ next time, (the multi-pane setup), press CTRL+q"
  _log_yellow "______________________________________________________"
}

function up-observablehq() {
  _log_yellow "Starting dashboards"
  rm -f src/.observablehq/cache/data/envs.json

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

function up-server() {
  _log_yellow "______________________________________________________"
  _log_yellow " to EXIT ZELLIJ, (the multi-pane setup), press CTRL+q"
  _log_yellow "______________________________________________________"

  go build -C ../server -o build/dashica-server ./cmd/dashica-server
  exec ../server/build/dashica-server
}

function clickhouse-client-docker-local() {
  local DB="monitoring"
  local USER="admin"
  local PASS="password"

  exec clickhouse client --host localhost --port 29001 --database "$DB" --user "$USER" --password "$PASS"
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
