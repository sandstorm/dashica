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

######### TASKS #########

# Easy setup of the project
function setup() {
  _log_yellow "Setting up your project"
  which gomplate > /dev/null || brew install gomplate
  npm i
  pushd kitchen-sink
  ./dev.sh setup
  popd
  _log_green "Done. To get started:"
  _log_green "  cd kitchen-sink"
  _log_green "  dev up"
  _log_green "http://127.0.0.1:8080"
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
