#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-unit}"

run_compile_check() {
  echo "==> Running compile check on tests..."
  cd test
  go test -c
  cd ..
}

run_unit_tests() {
  echo "==> Running unit tests..."
  # https://github.com/gotestyourself/gotestsum/releases
  go install gotest.tools/gotestsum@c4a0df2e75a225d979a444342dd3db752b53619f # v1.13.0
  make test
}

run_acc_tests() {
  echo "==> Running acceptance tests..."
  make testacc
}

run_relay_acc_tests() {
  echo "==> Running AWS Test Relay acceptance tests..."
  make testaccrelay
}

ensure_node_dependencies() {
  if [ ! -d node_modules ]; then
    echo "==> Installing Node dependencies..."
    npm install --silent
  fi
}

run_workflow_script_tests() {
  ensure_node_dependencies
  echo "==> Running workflow script unit tests..."
  node --test .github/workflows/scripts/tests/**/*.test.js
}

run_agent_script_tests() {
  ensure_node_dependencies
  echo "==> Running workflow script unit tests..."
  node --test agent-scripts/tests/**/*.test.js
}

run_all_tests() {
  run_compile_check
  run_unit_tests
  run_workflow_script_tests
  run_agent_script_tests
}

case "${MODE}" in
  compile)
    run_compile_check
    ;;
  unit)
    run_unit_tests
    ;;
  acc)
    run_acc_tests
    ;;
  acc-relay)
    run_relay_acc_tests
    ;;
  workflow-scripts)
    run_workflow_script_tests
    ;;
  agent-scripts)
    run_agent_script_tests
    ;;
  all)
    run_all_tests
    ;;
  *)
    echo "Error: Unknown test mode: ${MODE}" >&2
    echo "Usage: $0 [compile|unit|acc|acc-relay|workflow-scripts|agent-scripts|all]" >&2
    exit 1
    ;;
esac
