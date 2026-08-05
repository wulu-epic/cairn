#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
# Benchmark harness: Cairn vs agent-browser
#
# Runs both tools on a 6-task suite of varying difficulty, capturing
# per-command metrics: stdout bytes, stderr bytes, wall-clock ms, exit code.
# All stdout/stderr is saved to scripts/benchmark-output/ for analysis.
# Raw metrics are written to scripts/benchmark-results.jsonl (JSONL format).
#
# Fairness controls:
#   - Both tools keep Chrome alive across tasks (no per-task restart)
#   - Chrome startup cost is paid once per tool (first command only)
#   - agent-browser runs first, then closes Chrome; Cairn runs second
#   - Each tool uses its idiomatic best: agent-browser uses `find` semantic
#     locators + `snapshot -i`; Cairn uses NL `goto` intents + `look -i`
#   - Failures are recorded, not hidden — exit codes are captured honestly
# ═══════════════════════════════════════════════════════════════════════
set -u  # error on undefined vars, but NOT -e (we capture exit codes)

cd "$(dirname "$0")/.."  # scripts/ -> project root

RESULTS="scripts/benchmark-results.jsonl"
OUTDIR="scripts/benchmark-output"
mkdir -p "$OUTDIR"
: > "$RESULTS"  # truncate

# ── Helpers ────────────────────────────────────────────────────────────

# Portable millisecond timestamp (tries nanosecond date, falls back to seconds)
now_ms() {
  local ns
  ns=$(date +%s%N 2>/dev/null)
  if [[ "$ns" == *N ]]; then
    echo $(( $(date +%s) * 1000 ))
  else
    echo $(( ns / 1000000 ))
  fi
}

PYTHON=""
if command -v python3 &>/dev/null; then
  PYTHON="python3"
elif command -v python &>/dev/null; then
  PYTHON="python"
fi

# Run a command, capture all metrics, save output, append JSONL.
# Args: tool task step desc "command string"
timed_run() {
  local tool="$1" task="$2" step="$3" desc="$4" cmd="$5"
  local outfile="$OUTDIR/${tool}_${task}_${step}.out"
  local errfile="$OUTDIR/${tool}_${task}_${step}.err"

  local start
  start=$(now_ms)
  bash -c "$cmd" > "$outfile" 2> "$errfile"
  local code=$?
  local end
  end=$(now_ms)
  local ms=$((end - start))

  local ob eb
  ob=$(wc -c < "$outfile" | tr -d ' ')
  eb=$(wc -c < "$errfile" | tr -d ' ')

  # Append JSONL record
  printf '{"tool":"%s","task":"%s","step":"%s","desc":"%s","exit":%d,"ms":%d,"stdout_bytes":%d,"stderr_bytes":%d}\n' \
    "$tool" "$task" "$step" "$desc" "$code" "$ms" "$ob" "$eb" >> "$RESULTS"

  # Print summary line
  printf '  [%-5s] T%s %-40s exit=%d %6dms out=%7dB err=%5dB\n' \
    "$tool" "$task" "$desc" "$code" "$ms" "$ob" "$eb"
}

AB="agent-browser"
CAIRN="npx tsx src/cli.ts"

echo "╔════════════════════════════════════════════════════╗"
echo "║  BENCHMARK: Cairn vs agent-browser                 ║"
echo "║  6 tasks × 2 tools, per-command metrics captured   ║"
echo "╚════════════════════════════════════════════════════╝"
echo ""

# ═══════════════════════════════════════════════════════════════════════
# agent-browser tasks (run first, then close Chrome)
# ═══════════════════════════════════════════════════════════════════════
echo "━━━ agent-browser (v0.33.0) ━━━"

# T1: Navigate + read page structure (example.com)
timed_run ab T1 1 "open example.com"        "$AB open https://example.com"
timed_run ab T1 2 "snapshot -i"             "$AB snapshot -i"

# T2: Interactive-only view of complex page (wikipedia.org)
timed_run ab T2 1 "open wikipedia.org"      "$AB open https://www.wikipedia.org"
timed_run ab T2 2 "snapshot -i"             "$AB snapshot -i"

# T3: Simple search (DuckDuckGo 'typescript')
timed_run ab T3 1 "open duckduckgo.com"     "$AB open https://duckduckgo.com"
timed_run ab T3 2 "find searchbox fill"     "$AB find role searchbox fill 'typescript'"
timed_run ab T3 3 "press Enter"             "$AB press Enter"
timed_run ab T3 4 "snapshot -i (results)"   "$AB snapshot -i"

# T4: Dialog-based search (Wikipedia article page → search for 'artificial intelligence')
timed_run ab T4 1 "open wiki article"       "$AB open https://en.wikipedia.org/wiki/Web_browser"
timed_run ab T4 2 "snapshot -i"             "$AB snapshot -i"
timed_run ab T4 3 "find searchbox fill"     "$AB find role searchbox fill 'artificial intelligence'"
timed_run ab T4 4 "press Enter"             "$AB press Enter"
timed_run ab T4 5 "snapshot -i (results)"   "$AB snapshot -i"

# T5: Form fill (the-internet.herokuapp.com login)
timed_run ab T5 1 "open login form"         "$AB open https://the-internet.herokuapp.com/login"
timed_run ab T5 2 "snapshot -i"             "$AB snapshot -i"
# Extract refs from snapshot output for the fill commands
ab_userref=$(grep -iE 'textbox|edittext' "$OUTDIR/ab_T5_2.out" 2>/dev/null | head -1 | grep -oE 'e[0-9]+')
ab_passref=$(grep -i 'password' "$OUTDIR/ab_T5_2.out" 2>/dev/null | head -1 | grep -oE 'e[0-9]+')
if [ -z "${ab_passref:-}" ]; then
  ab_passref=$(grep -iE 'textbox|edittext' "$OUTDIR/ab_T5_2.out" 2>/dev/null | sed -n '2p' | grep -oE 'e[0-9]+')
fi
ab_userref="${ab_userref:-e0}"
ab_passref="${ab_passref:-e0}"
timed_run ab T5 3 "fill username (@$ab_userref)"  "$AB fill @$ab_userref 'tomsmith'"
timed_run ab T5 4 "fill password (@$ab_passref)"  "$AB fill @$ab_passref 'SuperSecretPassword!'"
timed_run ab T5 5 "click login button"      "$AB find role button click"
timed_run ab T5 6 "snapshot -i (result)"    "$AB snapshot -i"

# T6: Multi-step nav (example.com → click "Learn more" → verify iana.org)
timed_run ab T6 1 "open example.com"        "$AB open https://example.com"
timed_run ab T6 2 "click Learn more"        "$AB find text 'Learn more' click"
timed_run ab T6 3 "get url"                 "$AB get url"

# Close agent-browser Chrome
timed_run ab cleanup 1 "close"              "$AB close"

# ═══════════════════════════════════════════════════════════════════════
# Cairn tasks (run after agent-browser Chrome is closed)
# ═══════════════════════════════════════════════════════════════════════
echo ""
echo "━━━ Cairn (MVP, local Chrome backend) ━━━"

# T1: Navigate + read (goto shows tree immediately — no separate snapshot)
timed_run cairn T1 1 "goto example.com"     "$CAIRN goto https://example.com"

# T2: Interactive-only view
timed_run cairn T2 1 "goto wikipedia.org"   "$CAIRN goto https://www.wikipedia.org"
timed_run cairn T2 2 "look -i"              "$CAIRN look -i"

# T3: Simple search (DuckDuckGo — NL goto intent + click search button)
timed_run cairn T3 1 "goto duckduckgo.com"  "$CAIRN goto https://duckduckgo.com"
timed_run cairn T3 2 "type into search"     "$CAIRN goto 'type typescript into the search field'"
timed_run cairn T3 3 "click search button"  "$CAIRN goto 'click the search button'"
timed_run cairn T3 4 "look -i (results)"    "$CAIRN look -i"

# T4: Dialog-based search (Wikipedia article — click-to-reveal fallback)
timed_run cairn T4 1 "goto wiki article"    "$CAIRN goto https://en.wikipedia.org/wiki/Web_browser"
timed_run cairn T4 2 "type into search"     "$CAIRN goto 'type artificial intelligence into the search field'"
timed_run cairn T4 3 "look -i (results)"    "$CAIRN look -i"

# T5: Form fill (NL goto intents for each field + button)
timed_run cairn T5 1 "goto login form"      "$CAIRN goto https://the-internet.herokuapp.com/login"
timed_run cairn T5 2 "type username"        "$CAIRN goto 'type tomsmith into the username field'"
timed_run cairn T5 3 "type password"        "$CAIRN goto 'type SuperSecretPassword! into the password field'"
timed_run cairn T5 4 "click login"          "$CAIRN goto 'click the login button'"
timed_run cairn T5 5 "look (result)"        "$CAIRN look"

# T6: Multi-step nav (example.com → click "Learn more" → verify URL)
timed_run cairn T6 1 "goto example.com"     "$CAIRN goto https://example.com"
timed_run cairn T6 2 "click Learn more"     "$CAIRN goto 'click the learn more link'"
timed_run cairn T6 3 "status"               "$CAIRN status"

# Release Cairn session
timed_run cairn cleanup 1 "release"         "$CAIRN release"

# ═══════════════════════════════════════════════════════════════════════
# Aggregate summary
# ═══════════════════════════════════════════════════════════════════════
echo ""
echo "━━━ Aggregate Summary ━━━"
if [ -n "$PYTHON" ]; then
  RESULTS_FILE="$RESULTS" $PYTHON << 'PYEOF'
import json, os

results = []
with open(os.environ['RESULTS_FILE']) as f:
    for line in f:
        line = line.strip()
        if line:
            results.append(json.loads(line))

tools = {'ab': 'agent-browser', 'cairn': 'Cairn'}
tasks = ['T1','T2','T3','T4','T5','T6']

hdr = "{:<6} {:<16} {:>5} {:>10} {:>10} {:>10} {:>5}".format(
    'Task', 'Tool', 'Cmds', 'Time(ms)', 'Stdout(B)', 'Stderr(B)', 'Fail')
print(hdr)
print('-' * 65)
for task in tasks:
    for tool_key in ['ab', 'cairn']:
        rows = [r for r in results if r['tool'] == tool_key and r['task'] == task]
        cmds = len(rows)
        ms = sum(r['ms'] for r in rows)
        ob = sum(r['stdout_bytes'] for r in rows)
        eb = sum(r['stderr_bytes'] for r in rows)
        fail = sum(1 for r in rows if r['exit'] != 0)
        print("{:<6} {:<16} {:>5} {:>10} {:>10} {:>10} {:>5}".format(
            task, tools[tool_key], cmds, ms, ob, eb, fail))
    print()

print('-' * 65)
print("TOTAL")
for tool_key in ['ab', 'cairn']:
    rows = [r for r in results if r['tool'] == tool_key and r['task'] in tasks]
    cmds = len(rows)
    ms = sum(r['ms'] for r in rows)
    ob = sum(r['stdout_bytes'] for r in rows)
    eb = sum(r['stderr_bytes'] for r in rows)
    fail = sum(1 for r in rows if r['exit'] != 0)
    print("      {:<16} {:>5} {:>10} {:>10} {:>10} {:>5}".format(
        tools[tool_key], cmds, ms, ob, eb, fail))
PYEOF
  if [ $? -ne 0 ]; then
    echo "(summary generation failed — see $RESULTS for raw data)"
  fi
else
  echo "(python not found — see $RESULTS for raw JSONL data)"
fi

echo ""
echo "Raw results: $RESULTS"
echo "Output files: $OUTDIR/"
echo "Done."
