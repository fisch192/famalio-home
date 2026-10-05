import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
// Pure date/filter tests require no local Home Assistant or browser install.
globalThis.HTMLElement = class {};
globalThis.customElements = { get: () => true };
globalThis.window = { customCards: [] };
const source = await readFile(new URL('../../custom_components/famalio/frontend/famalio-calendar-card.js', import.meta.url), 'utf8');
const { normalizeConfig, viewRange, normalizeEvent, matchesEvent, overlapsDay, midnight, dayKey } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('presets stay independent, while explicit choices override their defaults', () => {
  const school = normalizeConfig({ preset: 'school', entities: ['calendar.school', 'calendar.school'], days: 10 });
  assert.deepEqual(school.weekdays, [1, 2, 3, 4, 5]);
  assert.equal(school.view, 'agenda'); assert.equal(school.days, 10);
  assert.deepEqual(school.entities, ['calendar.school']);
  const wall = normalizeConfig({ preset: 'wall', entity: 'calendar.family' });
  assert.equal(wall.show_clock, true); assert.equal(wall.text_size, 'large');
  school.weekdays.push(0);
  assert.deepEqual(normalizeConfig({ preset: 'school' }).weekdays, [1, 2, 3, 4, 5]);
});
test('invalid config cannot inject style or broaden entity selection', () => {
  for (const raw of [{ entities: ['light.kitchen'] }, { entities: 'calendar.school' }, { preset: 'unknown' }, { view: 'unknown' }, { color: 'red;display:none' }, { days: 0 }, { days: 32 }, { refresh_interval: 1 }, { weekdays: [7] }, { include: {} }, { show_clock: 'yes' }]) assert.throws(() => normalizeConfig(raw));
});
test('month ranges include complete weeks and navigation cannot overflow February', () => {
  assert.deepEqual(viewRange('2026-02-28', 'month', normalizeConfig({})), { start: '2026-01-26', end: '2026-03-02', days: Array.from({ length: 35 }, (_, i) => new Date(Date.parse('2026-01-26T12:00Z') + i * 86400000).toISOString().slice(0,10)) });
  const sunday = viewRange('2026-03-01', 'month', normalizeConfig({ first_day: 'sunday' }));
  assert.equal(sunday.start, '2026-03-01'); assert.equal(sunday.end, '2026-04-05');
  const week = viewRange('2026-10-11', 'week', normalizeConfig({}));
  assert.equal(week.start, '2026-10-05'); assert.equal(week.end, '2026-10-12');
});
test('HA time zone produces 23-hour and 25-hour days without clipping events', () => {
  const zone = 'Europe/Rome';
  assert.equal(midnight('2026-03-30', zone) - midnight('2026-03-29', zone), 23 * 3600000);
  assert.equal(midnight('2026-10-26', zone) - midnight('2026-10-25', zone), 25 * 3600000);
  assert.equal(dayKey(new Date('2026-10-04T23:30:00Z'), zone), '2026-10-05');
  const event = normalizeEvent({ start: { dateTime: '2026-10-25T00:00:00+02:00' }, end: { dateTime: '2026-10-26T00:00:00+01:00' }, summary: 'DST' }, 'calendar.family');
  assert.equal(overlapsDay(event, '2026-10-25', zone), true);
  assert.equal(overlapsDay(event, '2026-10-24', zone), false);
  assert.equal(overlapsDay(event, '2026-10-26', zone), false);
});
test('all-day exclusive ends and timed midnight boundaries show the right days', () => {
  const zone = 'Europe/Rome';
  const allDay = normalizeEvent({ start: { date: '2026-10-05' }, end: { date: '2026-10-07' }, summary: 'School holiday' }, 'calendar.school');
  for (const [day, result] of [['2026-10-04', false], ['2026-10-05', true], ['2026-10-06', true], ['2026-10-07', false]]) assert.equal(overlapsDay(allDay, day, zone), result);
  const overnight = normalizeEvent({ start: '2026-10-05T23:00:00+02:00', end: '2026-10-06T00:00:00+02:00' }, 'calendar.school');
  assert.equal(overlapsDay(overnight, '2026-10-05', zone), true);
  assert.equal(overlapsDay(overnight, '2026-10-06', zone), false);
  assert.equal(normalizeEvent({ start: 'broken', end: '2026-10-06' }, 'calendar.school'), null);
  assert.equal(normalizeEvent({ start: '2026-10-06', end: '2026-10-05' }, 'calendar.school'), null);
});
test('text includes are OR, exclusions take precedence, and title-only stays title-only', () => {
  const event = normalizeEvent({ summary: 'Emma – Mathematik', description: 'School homework', location: 'Room 2', start: '2026-10-05', end: '2026-10-06' }, 'calendar.school');
  for (const [raw, expected] of [[{ include: 'sport, SCHOOL' }, true], [{ include: 'Emma', exclude: 'math' }, false], [{ include: 'homework', match_field: 'summary' }, false], [{ include: 'room 2' }, true], [{ include: 'missing' }, false], [{ event_type: 'timed' }, false], [{ event_type: 'all_day' }, true]]) assert.equal(matchesEvent(event, normalizeConfig(raw)), expected);
});
test('bundled card and integration copy match the HACS installation', async () => {
  assert.equal(await readFile(new URL('../../famalio_home/integration/frontend/famalio-calendar-card.js', import.meta.url), 'utf8'), source);
  for (const file of ['__init__.py', 'manifest.json']) assert.equal(await readFile(new URL(`../../famalio_home/integration/${file}`, import.meta.url), 'utf8'), await readFile(new URL(`../../custom_components/famalio/${file}`, import.meta.url), 'utf8'));
});
