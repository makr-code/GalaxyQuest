#!/usr/bin/env bash

check_host_port() {
  local service=$1 port=$2 project=$3 listeners container inspected expected
  [[ "$port" =~ ^[0-9]{4,5}$ ]] && (( 10#$port >= 1024 && 10#$port <= 65535 && 10#$port != 3306 )) ||
    fail "Invalid $service host port: choose an unprivileged port other than 3306."
  listeners=$(ss -H -ltn "sport = :$port") || fail "Could not inspect host listeners for port $port."
  [[ -n "$listeners" ]] || return 0

  container=$(compose ps -q "$service") || fail "Could not inspect the current $service container."
  [[ -n "$container" && "$container" != *$'\n'* ]] ||
    fail "Host port $port for $service is already listening; choose a different port."
  inspected=$(docker inspect --format '{{.State.Running}} {{index .Config.Labels "com.docker.compose.project"}} {{index .Config.Labels "com.docker.compose.service"}} {{range $k, $v := .NetworkSettings.Ports}}{{range $v}}{{.HostIp}}:{{.HostPort}} {{end}}{{end}}' "$container") ||
    fail "Could not inspect the current $service port binding."
  expected="true $project $service 127.0.0.1:$port "
  [[ "$inspected" == "$expected" ]] ||
    fail "Host port $port is not owned by this project's running $service container."
  [[ "$(printf '%s\n' "$listeners" | awk 'NF {count++; if ($4 != "127.0.0.1:'"$port"'") bad=1} END {print count+0, bad+0}')" == "1 0" ]] ||
    fail "Host port $port has another or ambiguous listener; investigate before continuing."
}
