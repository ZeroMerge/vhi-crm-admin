import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  autoGranularity, buildBuckets, bucketStart, isoWeekLabel, isValidDateString, resolvePreset, startOfIsoWeek,
} from '../src/modules/reports/dateRange';
import { parseFilters, parseListParams, todayIn } from '../src/modules/reports/filters';

const LAGOS = 'Africa/Lagos';
const ok = (query: Record<string, unknown>, now?: Date, timezone = LAGOS) => {
  const r = parseFilters(query, { now, timezone });
  assert.ok(r.ok, JSON.stringify(r));
  return r.filters;
};
const bad = (query: Record<string, unknown>) => {
  const r = parseFilters(query, { timezone: LAGOS });
  assert.equal(r.ok, false, `expected rejection for ${JSON.stringify(query)}`);
  return r.ok ? [] : r.issues;
};

describe('date maths', () => {
  test('ISO weeks start on Monday and carry the ISO year', () => {
    assert.equal(startOfIsoWeek('2026-10-11'), '2026-10-05'); // Sunday belongs to the week of the previous Monday
    assert.equal(startOfIsoWeek('2026-10-12'), '2026-10-12');
    assert.equal(isoWeekLabel('2026-10-12'), '2026-W42');
    assert.equal(isoWeekLabel('2027-01-01'), '2026-W53'); // Friday: still ISO year 2026
    assert.equal(isoWeekLabel('2024-12-30'), '2025-W01'); // Monday: already ISO year 2025
    assert.equal(isoWeekLabel('2026-01-01'), '2026-W01');
  });

  test('buckets cover the range, clip the ends and mark them partial', () => {
    const b = buildBuckets('2026-10-07', '2026-10-20', 'week');
    assert.deepEqual(b.map((x) => [x.start, x.from, x.to, x.partial]), [
      ['2026-10-05', '2026-10-07', '2026-10-11', true],
      ['2026-10-12', '2026-10-12', '2026-10-18', false],
      ['2026-10-19', '2026-10-19', '2026-10-20', true],
    ]);
    const m = buildBuckets('2026-01-15', '2026-03-10', 'month');
    assert.deepEqual(m.map((x) => [x.label, x.from, x.to]), [
      ['2026-01', '2026-01-15', '2026-01-31'], ['2026-02', '2026-02-01', '2026-02-28'], ['2026-03', '2026-03-01', '2026-03-10'],
    ]);
    assert.equal(buildBuckets('2024-02-01', '2024-02-29', 'day').length, 29); // leap year
    assert.equal(buildBuckets('2025-12-31', '2026-01-01', 'year').length, 2);
    assert.equal(bucketStart('2026-02-28', 'year'), '2026-01-01');
  });

  test('presets resolve against the local date; auto granularity follows the span', () => {
    // Wednesday 2026-10-14
    assert.deepEqual(resolvePreset('this_week', '2026-10-14'), { from: '2026-10-12', to: '2026-10-14' });
    assert.deepEqual(resolvePreset('this_month', '2026-10-14'), { from: '2026-10-01', to: '2026-10-14' });
    assert.deepEqual(resolvePreset('this_year', '2026-10-14'), { from: '2026-01-01', to: '2026-10-14' });
    assert.deepEqual(resolvePreset('last_30_days', '2026-10-14'), { from: '2026-09-15', to: '2026-10-14' });
    assert.equal(autoGranularity('2026-10-01', '2026-10-31'), 'day');
    assert.equal(autoGranularity('2026-09-01', '2026-10-31'), 'week');
    assert.equal(autoGranularity('2026-01-01', '2026-12-31'), 'month');
    assert.equal(autoGranularity('2015-01-01', '2026-12-31'), 'year');
  });

  test('date strings must be real dates', () => {
    assert.ok(isValidDateString('2024-02-29'));
    assert.equal(isValidDateString('2026-02-29'), false);
    assert.equal(isValidDateString('2026-13-01'), false);
    assert.equal(isValidDateString('2026-1-1'), false);
  });
});

describe('time zone: "today" is the local date', () => {
  test('23:30 UTC on 31 October is already 1 November in Lagos, still 31 October in UTC and New York', () => {
    const instant = new Date('2026-10-31T23:30:00Z');
    assert.equal(todayIn('Africa/Lagos', instant), '2026-11-01');
    assert.equal(todayIn('UTC', instant), '2026-10-31');
    assert.equal(todayIn('America/New_York', instant), '2026-10-31');
    const f = ok({ range: 'this_month' }, instant);
    assert.deepEqual([f.from, f.to], ['2026-11-01', '2026-11-01']);
    const utc = ok({ range: 'this_month' }, instant, 'UTC');
    assert.deepEqual([utc.from, utc.to], ['2026-10-01', '2026-10-31']);
  });
});

describe('parseFilters', () => {
  test('defaults to this month, with an automatic granularity', () => {
    const f = ok({}, new Date('2026-10-14T10:00:00Z'));
    assert.deepEqual([f.range, f.from, f.to, f.granularity, f.timezone], ['this_month', '2026-10-01', '2026-10-14', 'day', LAGOS]);
  });

  test('accepts every filter and normalises the currency', () => {
    const f = ok({
      range: 'custom', from: '2026-01-01', to: '2026-06-30', granularity: 'month',
      customerId: '3f2c9a52-7a37-4b4a-9f0f-2f6f6b1f5a11', industry: 'none', statusGroup: 'in_progress', mode: 'sea_freight', currency: 'ngn',
    });
    assert.equal(f.currency, 'NGN');
    assert.equal(f.industry, 'none');
    assert.equal(f.mode, 'sea_freight');
  });

  test('blank values count as absent (a UI that always sends every key)', () => {
    const f = ok({ range: 'last_30_days', customerId: '', industry: '', currency: '', statusGroup: '' });
    assert.equal(f.customerId, undefined);
  });

  test('rejects invalid input with 400-style issues, all at once', () => {
    assert.ok(bad({ range: 'custom' }).length >= 2); // from and to are both required
    assert.ok(bad({ range: 'custom', from: '2026-10-31', to: '2026-10-01' }).some((i) => i.field === 'from'));
    assert.ok(bad({ range: 'this_month', from: '2026-10-01' }).some((i) => i.field === 'from')); // only with custom
    assert.ok(bad({ range: 'custom', from: '2026-02-30', to: '2026-03-01' }).some((i) => i.field === 'from'));
    assert.ok(bad({ range: 'last_year' }).length);
    assert.ok(bad({ granularity: 'hour' }).length);
    assert.ok(bad({ industry: 'bakery' }).length);
    assert.ok(bad({ statusGroup: 'draft' }).length); // drafts belong to no group
    assert.ok(bad({ mode: 'teleport' }).length);
    assert.ok(bad({ currency: 'N' }).length);
    assert.ok(bad({ currency: "NGN'; DROP TABLE invoices;--" }).length);
    assert.ok(bad({ customerId: 'not-a-uuid' }).length);
    assert.ok(bad({ unknown: '1' }).length); // strict: no silently ignored typos
    assert.ok(bad({ industry: ['oil_gas', 'mining'] }).length); // repeated query keys
  });

  test('caps: 10 years, and 400 periods', () => {
    assert.ok(ok({ range: 'custom', from: '2016-10-14', to: '2026-10-13' }).granularity === 'year');
    assert.ok(bad({ range: 'custom', from: '2016-10-01', to: '2026-10-13' }).some((i) => i.field === 'to'));
    // 401 days of daily buckets is one too many; 400 is fine
    assert.ok(bad({ range: 'custom', from: '2025-01-01', to: '2026-02-05', granularity: 'day' }).some((i) => i.field === 'granularity'));
    assert.equal(ok({ range: 'custom', from: '2025-01-01', to: '2026-02-04', granularity: 'day' }).granularity, 'day');
    assert.ok(bad({ range: 'custom', from: '2016-10-14', to: '2026-10-13', granularity: 'week' }).some((i) => i.field === 'granularity')); // 522 weeks
  });
});

describe('parseListParams', () => {
  const sorts = ['name', 'created'] as const;
  test('defaults and bounds', () => {
    const r = parseListParams({}, sorts, 'name');
    assert.ok(r.ok);
    assert.deepEqual(r.ok && r.list, { page: 1, pageSize: 25, sort: 'name', dir: 'asc' });
    assert.equal(parseListParams({ pageSize: '100' }, sorts, 'name').ok, true);
    assert.equal(parseListParams({ pageSize: '101' }, sorts, 'name').ok, false);
    assert.equal(parseListParams({ pageSize: '0' }, sorts, 'name').ok, false);
    assert.equal(parseListParams({ page: '0' }, sorts, 'name').ok, false);
    assert.equal(parseListParams({ page: 'x' }, sorts, 'name').ok, false);
    assert.equal(parseListParams({ sort: 'password_hash' }, sorts, 'name').ok, false);
    assert.equal(parseListParams({ dir: 'sideways' }, sorts, 'name').ok, false);
    assert.equal(parseListParams({ q: 'x'.repeat(101) }, sorts, 'name').ok, false);
  });
});
