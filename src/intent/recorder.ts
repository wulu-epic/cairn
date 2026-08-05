/**
 * Task Recording + Replay — REVOLUTION.md Leap 2.
 *
 * Record a successful agent run (every ref used, every fallback taken, every
 * DOM delta observed) and replay it later with zero LLM calls. Turns a 15-step
 * LLM task (45–60s, $0.30–1.50) into a deterministic replay (<5s, $0).
 *
 * This is what turns Cairn from a cost center into an asset library. Every
 * task the agent does once becomes a free, permanent, deterministic asset.
 *
 * Storage: OS-appropriate data directory:
 *   Windows: %APPDATA%/cairn/tasks/
 *   macOS:   ~/Library/Application Support/cairn/tasks/
 *   Linux:   ${XDG_DATA_HOME:-~/.local/share}/cairn/tasks/
 *
 * Prior art: Freu AI (record-once/replay-many, ~90% token reduction),
 * HyperAgent (Action Caching — deterministic replay without LLM calls),
 * rrweb (tool-call trace + DOM state recording for replay + divergence).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { Page } from 'playwright';
import type { Intent } from './parser.js';
import type { GroundResult } from './grounding.js';
import type { DeltaResult } from '../model/delta.js';
import { buildPageModel } from '../model/page-model.js';
import { clickByRef } from '../actions/click.js';
import { typeByRef } from '../actions/type.js';
import { hoverByRef } from '../actions/hover.js';
import { scrollByRef, scrollDirection } from '../actions/scroll.js';
import { selectByRef } from '../actions/select.js';
import { waitForPageSettled, computeDelta, renderDelta } from '../model/delta.js';
import { selfHealIntent, type ActionKind, type SelfHealOptions } from './self-heal.js';

// ─── Types ─────────────────────────────────────────────────────

export interface RecordedStep {
  stepIndex: number;
  /** The original NL goal the agent provided. */
  goal: string;
  /** The parsed intent. */
  intent: Intent;
  /** The ref that was grounded and acted on. */
  groundedRef?: string;
  /** The grounding confidence score. */
  groundScore?: number;
  /** Fallback strategies used (e.g. ['clickToReveal', 'embeddings', 'selfHeal']). */
  fallbacksUsed: string[];
  /** What action was executed. */
  actionKind: ActionKind;
  /** For type intents: the text typed. For select: the value selected. */
  text?: string;
  /** Whether the step succeeded. */
  success: boolean;
  /** The result message. */
  message: string;
  /** Page URL after the action. */
  url: string;
  /** Timestamp of the step. */
  timestamp: number;
}

export interface RecordedTask {
  /** Unique task ID (slug + short timestamp). */
  id: string;
  /** Human-friendly name. */
  name: string;
  /** Ordered list of recorded steps. */
  steps: RecordedStep[];
  /** The starting URL (first step's URL before the action). */
  startUrl: string;
  /** When the task was recorded. */
  createdAt: number;
  /** Recording format version (for forward compat). */
  version: string;
}

export interface ReplayResult {
  success: boolean;
  message: string;
  stepsCompleted: number;
  stepsTotal: number;
  /** Per-step results during replay. */
  stepResults: ReplayStepResult[];
  /** Steps where self-heal was triggered. */
  healsTriggered: number;
}

interface ReplayStepResult {
  stepIndex: number;
  success: boolean;
  message: string;
  healed: boolean;
  newRef?: string;
}

// ─── Data directory (OS-appropriate) ───────────────────────────

/**
 * Get the OS-appropriate data directory for Cairn.
 *
 * Windows: %APPDATA%/cairn (or ~/AppData/Roaming/cairn)
 * macOS:   ~/Library/Application Support/cairn
 * Linux:   ${XDG_DATA_HOME:-~/.local/share}/cairn
 *
 * Override with CAIRN_DATA_DIR env var if set.
 */
export function getDataDir(): string {
  if (process.env.CAIRN_DATA_DIR) {
    return process.env.CAIRN_DATA_DIR;
  }

  const home = os.homedir();
  const platform = os.platform();

  if (platform === 'win32') {
    const appdata = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return path.join(appdata, 'cairn');
  } else if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'cairn');
  } else {
    // Linux / other Unix: follow XDG Base Directory spec
    return process.env.XDG_DATA_HOME || path.join(home, '.local', 'share', 'cairn');
  }
}

/** Directory where recorded tasks are stored. */
export function getTasksDir(): string {
  return path.join(getDataDir(), 'tasks');
}

// ─── Task ID generation ────────────────────────────────────────

/**
 * Generate a task ID from a name: slugified name + short timestamp suffix.
 * e.g. "Log in to GitHub" → "log-in-to-github-l4x9k2"
 */
export function generateTaskId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  const ts = Date.now().toString(36).slice(-6);
  return slug ? `${slug}-${ts}` : `task-${ts}`;
}

// ─── Task Recorder ─────────────────────────────────────────────

/**
 * Records steps during an agent run. Call recordStep() after each executeGoto
 * call, then save() to persist the task to disk.
 */
export class TaskRecorder {
  private steps: RecordedStep[] = [];
  private name: string;
  private startUrl: string;

  constructor(name: string, startUrl: string) {
    this.name = name;
    this.startUrl = startUrl;
  }

  /** Record a single step's result. */
  recordStep(step: Omit<RecordedStep, 'stepIndex'>): void {
    this.steps.push({ ...step, stepIndex: this.steps.length });
  }

  /** Number of steps recorded so far. */
  get stepCount(): number {
    return this.steps.length;
  }

  /** Save the recorded task to disk. Returns the task ID + file path. */
  save(): { id: string; path: string } {
    const id = generateTaskId(this.name);
    const task: RecordedTask = {
      id,
      name: this.name,
      steps: this.steps,
      startUrl: this.startUrl,
      createdAt: Date.now(),
      version: '1.0',
    };

    const dir = getTasksDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${id}.json`);
    fs.writeFileSync(file, JSON.stringify(task, null, 2));

    return { id, path: file };
  }
}

// ─── Task storage (load / list / delete) ───────────────────────

/** Load a recorded task from disk by ID. Returns null if not found. */
export function loadTask(id: string): RecordedTask | null {
  const file = path.join(getTasksDir(), `${id}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as RecordedTask;
  } catch {
    return null;
  }
}

/** List all recorded tasks (sorted by creation date, newest first). */
export function listTasks(): Array<{ id: string; name: string; steps: number; createdAt: number; startUrl: string }> {
  const dir = getTasksDir();
  if (!fs.existsSync(dir)) return [];

  const tasks: Array<{ id: string; name: string; steps: number; createdAt: number; startUrl: string }> = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    try {
      const task = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as RecordedTask;
      tasks.push({
        id: task.id,
        name: task.name,
        steps: task.steps.length,
        createdAt: task.createdAt,
        startUrl: task.startUrl,
      });
    } catch {
      // Skip malformed files
    }
  }

  tasks.sort((a, b) => b.createdAt - a.createdAt);
  return tasks;
}

/** Delete a recorded task by ID. Returns true if deleted. */
export function deleteTask(id: string): boolean {
  const file = path.join(getTasksDir(), `${id}.json`);
  if (!fs.existsSync(file)) return false;
  try {
    fs.unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}

// ─── Replay ────────────────────────────────────────────────────

export interface ReplayOptions {
  /** Use self-heal when a recorded ref is stale. Default true. */
  useSelfHeal?: boolean;
  /** Pass through self-heal options. */
  selfHealOptions?: SelfHealOptions;
  /** Called per step with progress info (for CLI display). */
  onStep?: (step: RecordedStep, result: ReplayStepResult) => void;
}

/**
 * Replay a recorded task deterministically — zero LLM calls.
 *
 * Each recorded step's intent is re-executed against the live page. If the
 * recorded ref is stale, self-heal kicks in (re-ground by intent) before
 * giving up.
 *
 * @param page  The Playwright page (should be at the task's start URL).
 * @param taskId The recorded task ID to replay.
 * @param options Replay options.
 */
export async function replayTask(
  page: Page,
  taskId: string,
  options: ReplayOptions = {},
): Promise<ReplayResult> {
  const task = loadTask(taskId);
  if (!task) {
    return {
      success: false,
      message: `task "${taskId}" not found. Run "cairn tasks" to list recorded tasks.`,
      stepsCompleted: 0,
      stepsTotal: 0,
      stepResults: [],
      healsTriggered: 0,
    };
  }

  // Navigate to the start URL
  if (task.startUrl && page.url() !== task.startUrl) {
    try {
      await page.goto(task.startUrl, { waitUntil: 'domcontentloaded' });
      await waitForPageSettled(page);
    } catch {
      // Continue even if navigation fails — the page might already be there
    }
  }

  const useSelfHeal = options.useSelfHeal ?? true;
  const stepResults: ReplayStepResult[] = [];
  let healsTriggered = 0;
  let stepsCompleted = 0;

  for (const step of task.steps) {
    const stepResult: ReplayStepResult = {
      stepIndex: step.stepIndex,
      success: false,
      message: '',
      healed: false,
    };

    // Determine the action kind + text
    const actionKind = step.actionKind;
    const text = step.text;

    // Try the recorded ref first (fast path — zero LLM, zero grounding)
    try {
      const actionResult = await executeReplayAction(page, actionKind, step.groundedRef!, text);
      if (actionResult.success) {
        stepResult.success = true;
        stepResult.message = actionResult.message;
        await waitForPageSettled(page);
        stepsCompleted++;
        stepResults.push(stepResult);
        options.onStep?.(step, stepResult);
        continue;
      }
    } catch {
      // Ref stale — fall through to self-heal
    }

    // Recorded ref failed — self-heal by re-grounding the intent
    if (useSelfHeal && step.intent) {
      const heal = await selfHealIntent(
        page,
        step.intent,
        step.groundedRef,
        actionKind,
        text,
        options.selfHealOptions,
      );

      if (heal.healed && heal.actionSuccess) {
        stepResult.success = true;
        stepResult.message = heal.actionMessage;
        stepResult.healed = true;
        stepResult.newRef = heal.newRef;
        healsTriggered++;
        stepsCompleted++;
        stepResults.push(stepResult);
        options.onStep?.(step, stepResult);
        continue;
      }
    }

    // Self-heal failed or disabled — record the failure
    stepResult.success = false;
    stepResult.message = `step ${step.stepIndex + 1} failed: recorded ref ${step.groundedRef} is stale and self-heal could not recover`;
    stepResults.push(stepResult);
    options.onStep?.(step, stepResult);

    // Stop on first failure (deterministic replay = all-or-nothing)
    return {
      success: false,
      message: `replay failed at step ${step.stepIndex + 1}/${task.steps.length}: ${stepResult.message}`,
      stepsCompleted,
      stepsTotal: task.steps.length,
      stepResults,
      healsTriggered,
    };
  }

  return {
    success: true,
    message: `replayed ${task.name}: ${stepsCompleted}/${task.steps.length} steps${healsTriggered > 0 ? ` (${healsTriggered} self-healed)` : ''}`,
    stepsCompleted,
    stepsTotal: task.steps.length,
    stepResults,
    healsTriggered,
  };
}

/**
 * Execute a single replay action by kind + ref + text.
 */
async function executeReplayAction(
  page: Page,
  kind: ActionKind,
  ref: string,
  text?: string,
): Promise<{ success: boolean; message: string }> {
  if (kind === 'click') {
    return clickByRef(page, ref);
  } else if (kind === 'type' && text !== undefined) {
    return typeByRef(page, ref, text);
  } else if (kind === 'hover') {
    return hoverByRef(page, ref);
  } else if (kind === 'scroll') {
    return scrollByRef(page, ref);
  } else if (kind === 'select' && text !== undefined) {
    return selectByRef(page, ref, text);
  }
  return { success: false, message: `unsupported action kind: ${kind}` };
}

// ─── Rendering (for CLI display) ───────────────────────────────

/** Format a task list for CLI display. */
export function renderTaskList(tasks: Array<{ id: string; name: string; steps: number; createdAt: number; startUrl: string }>): string {
  if (tasks.length === 0) {
    return 'No recorded tasks. Use "cairn goto <goal> --record <name>" to record one.';
  }
  const lines: string[] = [`Recorded tasks (${tasks.length}):`];
  for (const t of tasks) {
    const date = new Date(t.createdAt).toLocaleString();
    lines.push(`  ${t.id}`);
    lines.push(`    name: ${t.name}`);
    lines.push(`    steps: ${t.steps}  |  created: ${date}`);
    lines.push(`    start: ${t.startUrl}`);
  }
  return lines.join('\n');
}

/** Format a single task's details for CLI display. */
export function renderTaskDetails(task: RecordedTask): string {
  const lines: string[] = [];
  lines.push(`Task: ${task.name}`);
  lines.push(`ID: ${task.id}`);
  lines.push(`Steps: ${task.steps.length}`);
  lines.push(`Start URL: ${task.startUrl}`);
  lines.push(`Created: ${new Date(task.createdAt).toLocaleString()}`);
  lines.push('');
  lines.push('Steps:');
  for (const step of task.steps) {
    const status = step.success ? '✓' : '✗';
    const ref = step.groundedRef ? ` [${step.groundedRef}]` : '';
    const text = step.text ? ` "${step.text}"` : '';
    const fallbacks = step.fallbacksUsed.length > 0 ? ` (fallbacks: ${step.fallbacksUsed.join(', ')})` : '';
    lines.push(`  ${status} ${step.stepIndex + 1}. ${step.actionKind}${ref}${text} — ${step.message.slice(0, 80)}${fallbacks}`);
  }
  return lines.join('\n');
}
