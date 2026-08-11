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

run_workflow_script_tests() {
  echo "==> Running workflow script unit tests..."
  node --test .github/workflows/scripts/tests/**/*.test.js
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
  scripts)
    run_workflow_script_tests
    ;;
  *)
    echo "Error: Unknown test mode: ${MODE}" >&2
    echo "Usage: $0 [compile|unit|acc|acc-relay|scripts]" >&2
    exit 1
    ;;
esac
