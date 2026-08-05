/**
 * Unit tests for the task recorder module (Leap 2).
 *
 * Tests serialization/deserialization (save/load/list/delete), task ID
 * generation, and OS-appropriate data directory resolution. Uses temp
 * directories (no real OS data dir pollution).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  TaskRecorder,
  loadTask,
  listTasks,
  deleteTask,
  generateTaskId,
  getDataDir,
  getTasksDir,
} from './intent/recorder.js';
import type { RecordedStep, RecordedTask } from './intent/recorder.js';
import type { Intent } from './intent/parser.js';

// Use a temp directory for test isolation — override CAIRN_DATA_DIR
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-test-'));

beforeEach(() => {
  process.env.CAIRN_DATA_DIR = TMP_DIR;
});

afterEach(() => {
  // Clean up temp dir contents between tests
  const tasksDir = path.join(TMP_DIR, 'tasks');
  if (fs.existsSync(tasksDir)) {
    for (const f of fs.readdirSync(tasksDir)) {
      fs.unlinkSync(path.join(tasksDir, f));
    }
  }
});

// Helper: create a minimal recorded step for testing
function makeStep(overrides: Partial<RecordedStep> = {}): Omit<RecordedStep, 'stepIndex'> {
  const intent: Intent = { kind: 'click', target: 'submit' };
  return {
    goal: 'click the submit button',
    intent,
    groundedRef: 'e5',
    groundScore: 0.85,
    fallbacksUsed: [],
    actionKind: 'click',
    success: true,
    message: 'clicked [e5] button "Submit"',
    url: 'https://example.com',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('TaskRecorder', () => {
  it('records steps and saves to disk', () => {
    const recorder = new TaskRecorder('Test Task', 'https://example.com');
    recorder.recordStep(makeStep());
    recorder.recordStep(makeStep({ goal: 'type hello', actionKind: 'type', text: 'hello' }));

    expect(recorder.stepCount).toBe(2);

    const result = recorder.save();
    expect(result.id).toContain('test-task');
    expect(fs.existsSync(result.path)).toBe(true);

    // Verify file content is valid JSON
    const raw = JSON.parse(fs.readFileSync(result.path, 'utf8')) as RecordedTask;
    expect(raw.name).toBe('Test Task');
    expect(raw.steps).toHaveLength(2);
    expect(raw.steps[0].stepIndex).toBe(0);
    expect(raw.steps[1].stepIndex).toBe(1);
    expect(raw.startUrl).toBe('https://example.com');
    expect(raw.version).toBe('1.0');
  });

  it('assigns incrementing step indices', () => {
    const recorder = new TaskRecorder('Index Test', 'https://test.com');
    recorder.recordStep(makeStep());
    recorder.recordStep(makeStep());
    recorder.recordStep(makeStep());

    const result = recorder.save();
    const task = loadTask(result.id)!;
    expect(task.steps[0].stepIndex).toBe(0);
    expect(task.steps[1].stepIndex).toBe(1);
    expect(task.steps[2].stepIndex).toBe(2);
  });
});

describe('loadTask', () => {
  it('loads a saved task by ID', () => {
    const recorder = new TaskRecorder('Loadable Task', 'https://load.com');
    recorder.recordStep(makeStep({ groundedRef: 'e10' }));
    const { id } = recorder.save();

    const loaded = loadTask(id);
    expect(loaded).not.toBeNull();
    expect(loaded!.name).toBe('Loadable Task');
    expect(loaded!.steps[0].groundedRef).toBe('e10');
  });

  it('returns null for non-existent task', () => {
    const loaded = loadTask('does-not-exist-12345');
    expect(loaded).toBeNull();
  });
});

describe('listTasks', () => {
  it('lists saved tasks sorted by creation date (newest first)', async () => {
    const r1 = new TaskRecorder('Task A', 'https://a.com');
    r1.recordStep(makeStep());
    r1.save();

    // Small delay to ensure different timestamps
    await new Promise((r) => setTimeout(r, 10));

    const r2 = new TaskRecorder('Task B', 'https://b.com');
    r2.recordStep(makeStep());
    r2.save();

    const tasks = listTasks();
    expect(tasks).toHaveLength(2);
    // Newest first (Task B has higher timestamp)
    expect(tasks[0].name).toBe('Task B');
    expect(tasks[1].name).toBe('Task A');
    expect(tasks[0].steps).toBe(1);
    expect(tasks[0].startUrl).toBe('https://b.com');
  });

  it('returns empty array when no tasks exist', () => {
    const tasks = listTasks();
    expect(tasks).toEqual([]);
  });
});

describe('deleteTask', () => {
  it('deletes a saved task', () => {
    const recorder = new TaskRecorder('Deletable', 'https://del.com');
    recorder.recordStep(makeStep());
    const { id } = recorder.save();

    expect(loadTask(id)).not.toBeNull();
    const deleted = deleteTask(id);
    expect(deleted).toBe(true);
    expect(loadTask(id)).toBeNull();
  });

  it('returns false for non-existent task', () => {
    const deleted = deleteTask('no-such-task-999');
    expect(deleted).toBe(false);
  });
});

describe('generateTaskId', () => {
  it('slugifies name and appends timestamp', () => {
    const id = generateTaskId('Log In to GitHub!');
    expect(id).toMatch(/^log-in-to-github-[a-z0-9]+$/);
  });

  it('handles empty name gracefully', () => {
    const id = generateTaskId('');
    expect(id).toMatch(/^task-[a-z0-9]+$/);
  });

  it('handles special characters', () => {
    const id = generateTaskId('Buy @ $pecial Items!!!');
    expect(id).toMatch(/^buy-pecial-items-[a-z0-9]+$/);
  });
});

describe('getDataDir', () => {
  it('respects CAIRN_DATA_DIR override', () => {
    process.env.CAIRN_DATA_DIR = '/custom/path';
    expect(getDataDir()).toBe('/custom/path');
    delete process.env.CAIRN_DATA_DIR;
  });

  it('falls back to OS-appropriate directory', () => {
    delete process.env.CAIRN_DATA_DIR;
    const dir = getDataDir();
    const home = os.homedir();
    const platform = os.platform();

    if (platform === 'win32') {
      // Should be APPDATA or ~/AppData/Roaming/cairn
      expect(dir).toContain('cairn');
    } else if (platform === 'darwin') {
      expect(dir).toBe(path.join(home, 'Library', 'Application Support', 'cairn'));
    } else {
      // Linux: XDG or ~/.local/share/cairn
      expect(dir).toContain('cairn');
    }
  });

  it('getTasksDir appends tasks subdirectory', () => {
    process.env.CAIRN_DATA_DIR = '/custom/path';
    expect(getTasksDir()).toBe(path.join('/custom/path', 'tasks'));
    delete process.env.CAIRN_DATA_DIR;
  });
});
