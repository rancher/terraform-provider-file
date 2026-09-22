#!/usr/bin/env bash
set -euo pipefail

run_compile_check() {
  echo "==> Running compile check on tests..."
  if [[ ! -d "test" ]]; then
    echo "No 'test' directory found, skipping compile check."
    return 0
  fi
  cd test
  if [[ -f "go.mod" ]]; then
    go test -c
  else
    echo "No go.mod found in 'test' directory, skipping compile check."
  fi
  cd ..
}

run_unit_tests() {
  echo "==> Running unit tests..."
  if [[ ! -f "GNUmakefile" ]]; then
    echo "No Makefile found."
    return 1
  fi
  if [[ ! -f "go.mod" ]]; then
    echo "No go.mod found in root directory, skipping unit tests."
    return 0
  fi
  # https://github.com/gotestyourself/gotestsum/releases
  go install gotest.tools/gotestsum@c4a0df2e75a225d979a444342dd3db752b53619f # v1.13.0
  make test
}

run_acc_tests() {
  echo "==> Running acceptance tests..."
  if [[ ! -f "GNUmakefile" ]]; then
    echo "No Makefile found"
    return 1
  fi
  make testacc
}

run_relay_acc_tests() {
  echo "==> Running AWS Test Relay acceptance tests..."
  if [[ ! -f "GNUmakefile" ]]; then
    echo "No Makefile found"
    return 1
  fi
  make testaccrelay
}

ensure_node_dependencies() {
  echo "==> Running project setup..."
  if [[ ! -d "node_modules" ]]; then
    npm ci --silent || npm install --silent
  fi
  if [[ ! -d "node_modules/@google/gemini-cli-sdk" ]]; then
    npm run setup
  fi
}

run_workflow_script_tests() {
  if [[ ! -d ".github/workflows/scripts/tests" ]]; then
    echo "No workflow script tests directory found."
    return 1
  fi
  ensure_node_dependencies
  echo "==> Running workflow script unit tests..."

  local test_files=()
  while IFS= read -r -d '' file; do
    test_files+=("$file")
  done < <(find ".github/workflows/scripts/tests" -type f \( -name "*.js" -o -name "*.ts" \) -print0 2>/dev/null)
  if [[ ${#test_files[@]} -gt 0 ]]; then
    node --test "${test_files[@]}"
  else
    echo "No test files found in .github/workflows/scripts/tests"
  fi
}

run_agent_script_tests() {
  if [[ ! -d "agent-scripts/tests" ]]; then
    echo "No agent script tests directory found"
    return 1
  fi
  ensure_node_dependencies
  echo "==> Running agent script unit tests..."

  local test_files=()
  while IFS= read -r -d '' file; do
    test_files+=("$file")
  done < <(find "agent-scripts/tests" -type f \( -name "*.js" -o -name "*.ts" \) -print0 2>/dev/null)
  if [[ ${#test_files[@]} -gt 0 ]]; then
    node --test "${test_files[@]}"
  else
    echo "No test files found in agent-scripts/tests"
  fi
}

run_all_tests() {
  run_compile_check
  run_unit_tests
  run_workflow_script_tests
  run_agent_script_tests
}

show_help() {
  cat <<EOF
Usage: test.sh [mode]

Options:
  -h, --help    Show this help message and exit.

Modes:
  compile           Run compile check on tests
  unit              Run unit tests
  acc               Run acceptance tests
  acc-relay         Run AWS Test Relay acceptance tests
  workflow-scripts  Run workflow script unit tests
  agent-scripts     Run agent script unit tests
  all               Run all compile, unit, and script tests

Default mode is 'unit'.
EOF
}

main() {
  local mode="${1:-unit}"

  if [[ "${mode}" == "-h" || "${mode}" == "--help" ]]; then
    show_help
    exit 0
  fi

  # Defensive check: if Go files exist but no go.mod is present anywhere, fail early to prevent silent skipped tests
  local go_files
  go_files=$(git ls-files "*.go" 2>/dev/null | head -n 1)
  local go_mods
  go_mods=$(find . -name "go.mod" -not -path "*/.terraform/*" | head -n 1)
  if [[ -n "${go_files}" && -z "${go_mods}" ]]; then
    echo "Error: Go source files were found, but no go.mod is present!" >&2
    exit 1
  fi

  case "${mode}" in
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
      echo "Error: Unknown test mode: ${mode}" >&2
      show_help >&2
      exit 1
      ;;
  esac
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "${@}"
fi
