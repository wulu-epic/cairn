#!/usr/bin/env node

/**
 * ai-browser-tester — agent-first browser testing tool
 * Usage: abt <command> [args] [--session <id>]
 */

const args = process.argv.slice(2);
const command = args[0];

const COMMANDS = ['focus', 'click', 'type', 'look', 'status', 'goto', 'extract'] as const;
type Command = (typeof COMMANDS)[number];

function printHelp(): void {
  console.log(`ai-browser-tester — agent-first browser testing tool

Usage: abt <command> [args] [--session <id>]

Commands:
  focus <region|ref>   Zoom into a region/subtree (token-efficient)
  click <ref>          Deterministic click by stable ref
  type <ref> <text>    Fill a field by ref
  look                 Show current page tree (the "I'm confused" command)
  status               Show session state (URL, focused region, last delta)
  goto "<nl goal>"     High-level intent (perceive+ground+act+verify internally)
  extract <schema>     Structured data extraction

Options:
  --session <id>       Session ID (default: default)
  --help, -h           Show this help
`);
}

if (!command || command === '--help' || command === '-h') {
  printHelp();
  process.exit(0);
}

if (!COMMANDS.includes(command as Command)) {
  console.error(`Unknown command: ${command}`);
  console.error(`Available commands: ${COMMANDS.join(', ')}`);
  process.exit(1);
}

// TODO: implement command dispatch (p3)
console.error(`[stub] command="${command}" args=${JSON.stringify(args.slice(1))}`);
