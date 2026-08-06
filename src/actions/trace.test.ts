import { describe, it, expect } from 'vitest';
import { decodeTrace, type TraceEvents, type NetworkEvent } from './trace.js';

function makeEvents(overrides: Partial<TraceEvents> = {}): TraceEvents {
  return {
    network: [],
    console: [],
    errors: [],
    navigations: [],
    ...overrides,
  };
}

function net(overrides: Partial<NetworkEvent> = {}): NetworkEvent {
  return {
    method: 'GET',
    url: 'https://example.com/api/data',
    resourceType: 'fetch',
    status: 200,
    ...overrides,
  };
}

describe('decodeTrace', () => {
  it('renders empty trace with all sections showing (none)', () => {
    const digest = decodeTrace(makeEvents(), 800);
    expect(digest).toContain('── trace (0.8s) ──');
    expect(digest).toContain('network (0 reqs):');
    expect(digest).toContain('  (none)');
    expect(digest).toContain('console (0):');
    expect(digest).toContain('errors (0)');
  });

  it('marks the first failed request as likely culprit', () => {
    const events = makeEvents({
      network: [
        net({ method: 'POST', url: 'https://example.com/api/login', status: 200 }),
        net({
          method: 'POST',
          url: 'https://example.com/api/analytics',
          status: 500,
          statusText: 'internal server error',
        }),
      ],
    });
    const digest = decodeTrace(events, 800);
    expect(digest).toContain('network (2 reqs, 1 failed):');
    expect(digest).toContain('POST /api/login → 200');
    expect(digest).toContain(
      'POST /api/analytics → 500 internal server error ← likely culprit',
    );
  });

  it('filters out static assets (css, js, image, font)', () => {
    const events = makeEvents({
      network: [
        net({ resourceType: 'stylesheet', url: 'https://example.com/style.css' }),
        net({ resourceType: 'script', url: 'https://example.com/app.js' }),
        net({ resourceType: 'image', url: 'https://example.com/logo.png' }),
        net({ resourceType: 'font', url: 'https://example.com/font.woff2' }),
        net({ resourceType: 'fetch', url: 'https://example.com/api/data', status: 200 }),
      ],
    });
    const digest = decodeTrace(events, 100);
    expect(digest).toContain('network (1 req):');
    expect(digest).toContain('GET /api/data → 200');
    expect(digest).not.toContain('style.css');
    expect(digest).not.toContain('app.js');
    expect(digest).not.toContain('logo.png');
    expect(digest).not.toContain('font.woff2');
  });

  it('dedupes same-URL retries, keeping the last status', () => {
    const events = makeEvents({
      network: [
        net({
          method: 'POST',
          url: 'https://example.com/api/submit',
          status: 500,
          statusText: 'error',
        }),
        net({ method: 'POST', url: 'https://example.com/api/submit', status: 200 }),
      ],
    });
    const digest = decodeTrace(events, 100);
    // Deduped to one entry, last wins (200) — so no failure, no culprit.
    expect(digest).toContain('network (1 req):');
    expect(digest).toContain('POST /api/submit → 200');
    expect(digest).not.toContain('← likely culprit');
  });

  it('caps network entries and shows +N more', () => {
    const netEvents: NetworkEvent[] = [];
    for (let i = 0; i < 15; i++) {
      netEvents.push(net({ url: `https://example.com/api/item${i}`, status: 200 }));
    }
    const events = makeEvents({ network: netEvents });
    const digest = decodeTrace(events, 100, { maxNetwork: 10 });
    expect(digest).toContain('network (15 reqs):');
    expect(digest).toContain('… +5 more');
  });

  it('marks first JS error as culprit when no failed requests', () => {
    const events = makeEvents({
      network: [net({ status: 200 })],
      errors: [{ message: 'TypeError: Cannot read property x of undefined' }],
    });
    const digest = decodeTrace(events, 500);
    expect(digest).toContain('errors (1)');
    expect(digest).toContain(
      'TypeError: Cannot read property x of undefined ← likely culprit',
    );
  });

  it('renders console events with [tag] prefix (warning → warn)', () => {
    const events = makeEvents({
      console: [
        { type: 'warning', text: 'submitButton.onclick is deprecated' },
        { type: 'error', text: 'something went wrong' },
      ],
    });
    const digest = decodeTrace(events, 100);
    expect(digest).toContain('console (2):');
    expect(digest).toContain('[warn] submitButton.onclick is deprecated');
    expect(digest).toContain('[error] something went wrong');
  });

  it('truncates long console/error strings', () => {
    const longText = 'x'.repeat(200);
    const events = makeEvents({
      console: [{ type: 'log', text: longText }],
    });
    const digest = decodeTrace(events, 100, { maxTextLength: 50 });
    // Should be truncated to 47 chars + "..."
    expect(digest).toContain('...');
    expect(digest).not.toContain('x'.repeat(200));
    const consoleLine = digest.split('\n').find((l) => l.includes('[log]'));
    expect(consoleLine).toBeDefined();
    expect(consoleLine!.length).toBeLessThan(60);
  });

  it('shows blocked for requests with no response (status undefined)', () => {
    const events = makeEvents({
      network: [
        net({ url: 'https://example.com/api/blocked', status: undefined }),
      ],
    });
    const digest = decodeTrace(events, 100);
    expect(digest).toContain('GET /api/blocked → blocked');
    expect(digest).toContain('← likely culprit');
  });

  it('keeps document resource type (page navigations) but drops media', () => {
    const events = makeEvents({
      network: [
        net({ resourceType: 'document', url: 'https://example.com/page', status: 200 }),
        net({ resourceType: 'media', url: 'https://example.com/video.mp4' }),
        net({ resourceType: 'xhr', url: 'https://example.com/api/track', status: 204 }),
      ],
    });
    const digest = decodeTrace(events, 100);
    expect(digest).toContain('network (2 reqs):');
    expect(digest).toContain('GET /page → 200');
    expect(digest).toContain('GET /api/track → 204');
    expect(digest).not.toContain('video.mp4');
  });
});
