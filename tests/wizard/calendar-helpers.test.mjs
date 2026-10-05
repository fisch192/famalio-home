import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarMatchTemplate, createCalendarAutomation, automationCalendarIDs } from '../../famalio_home/wizard/public/calendar-helpers.js';
const b64 = (value) => Buffer.from(value, 'utf8').toString('base64');

test('automation list follows actual connected calendar triggers, including renamed and manual rules', () => {
  const known = ['calendar.family', 'calendar.shifts'];
  assert.deepEqual(automationCalendarIDs({ alias: 'Renamed rule', triggers: [{ trigger: 'calendar.event_started', target: { entity_id: 'calendar.family' } }] }, known), ['calendar.family']);
  assert.deepEqual(automationCalendarIDs({ trigger: { platform: 'calendar', entity_id: 'calendar.shifts', event: 'end' } }, known), ['calendar.shifts']);
  assert.deepEqual(automationCalendarIDs({ triggers: [{ trigger: 'calendar.event_ended', target: { entity_id: ['calendar.other', 'calendar.shifts'] } }] }, known), ['calendar.shifts']);
  assert.deepEqual(automationCalendarIDs({ alias: 'Famalio · unrelated', triggers: [{ trigger: 'state', entity_id: 'calendar.family' }] }, known), []);
  assert.deepEqual(automationCalendarIDs(null, known), []);
});

test('nested HA trigger groups deduplicate matches and ignore other calendars', () => {
  assert.deepEqual(automationCalendarIDs({ triggers: [{ triggers: [
    { trigger: 'calendar.event_started', target: { entity_id: 'calendar.family' } },
    { trigger: 'calendar.event_ended', target: { entity_id: 'calendar.family' } },
    { trigger: 'calendar.event_started', target: { entity_id: 'calendar.other' } },
  ] }] }, ['calendar.family']), ['calendar.family']);
});

test('repeating activity matches the exact event summary through a base64 variable', () => {
  const match = calendarMatchTemplate({ summary: 'Swimming' }, 'activity');
  assert.equal(match.template, '{{ trigger.calendar_event.summary == (famalio_summary_b64 | base64_decode) }}');
  assert.equal(match.variables.famalio_summary_b64, b64('Swimming'));
  assert.doesNotMatch(match.template, /Swimming/);
});

test('templated and injected title text remains encoded data', () => {
  const title = `Dinner ' }} {% set x = 1 %} <script>alert(1)</script> 🥐`;
  const match = calendarMatchTemplate({ summary: title }, 'activity');
  assert.equal(match.variables.famalio_summary_b64, b64(title));
  assert.doesNotMatch(match.template, /Dinner|script|set x|alert/);
});

test('single timed occurrence always matches the original start, even with a series UID', () => {
  const match = calendarMatchTemplate({ summary: 'Dinner', uid: 'uid/one', start: '2026-10-02T17:00:00+02:00' }, 'occurrence');
  assert.match(match.template, /summary == \(famalio_summary_b64 \| base64_decode\)/);
  assert.match(match.template, /uid is defined/);
  assert.match(match.template, /as_timestamp\(trigger.calendar_event.start\) == as_timestamp\(famalio_start\)/);
  assert.equal(match.variables.famalio_start, '2026-10-02T15:00:00.000Z');
  assert.equal(match.variables.famalio_uid_b64, b64('uid/one'));
});

test('single all-day occurrence matches the original calendar date', () => {
  const match = calendarMatchTemplate({ summary: 'Holiday', start: '2026-12-25', all_day: true }, 'occurrence');
  assert.match(match.template, /trigger.calendar_event.start == famalio_start/);
  assert.equal(match.variables.famalio_start, '2026-12-25');
});

test('automation uses current calendar event-start trigger, bounds offsets, and queues overlaps', () => {
  const config = createCalendarAutomation({ entity_id: 'calendar.family', summary: 'Dinner', start: '2026-10-02T17:00:00Z' }, 'scene.evening', 'occurrence', 'before_start', 2000);
  assert.equal(config.triggers[0].trigger, 'calendar.event_started');
  assert.deepEqual(config.triggers[0].options, { offset: { minutes: 1440 }, offset_type: 'before' });
  assert.equal(config.actions[0].action, 'scene.turn_on');
  assert.equal(config.mode, 'queued');
  assert.equal('initial_state' in config, false);
});

test('automation supports event-end trigger and after-end offset', () => {
  const config = createCalendarAutomation({ entity_id: 'calendar.family', summary: 'Dinner' }, 'script.goodnight', 'activity', 'after_end', 10);
  assert.equal(config.triggers[0].trigger, 'calendar.event_ended');
  assert.deepEqual(config.triggers[0].options, { offset: { minutes: 10 }, offset_type: 'after' });
  assert.equal(config.actions[0].action, 'script.turn_on');
});

import { normalizeActions, parseActionData, automationRule, ruleMatchesEvent, editorEvent, zonedISO, canWrite, FEATURE } from '../../famalio_home/wizard/public/calendar-helpers.js';

test('keyword rules match case-insensitively through an encoded variable', () => {
  const config = createCalendarAutomation({ entity_id: 'calendar.family', summary: 'Frühschicht Team A' }, 'light.flur', 'keyword', 'start', 0, 'schicht');
  assert.match(config.conditions[0].value_template, /famalio_keyword_b64 \| base64_decode \| lower\) in/);
  assert.equal(config.variables.famalio_keyword_b64, b64('schicht'));
  assert.equal(config.variables.famalio_rule.scope, 'keyword');
  assert.doesNotMatch(JSON.stringify(config.conditions), /schicht/);
  assert.throws(() => createCalendarAutomation({ entity_id: 'calendar.family' }, 'scene.x', 'keyword', 'start', 0, '  '));
});

test('calendar-wide rules have no condition and cover every event', () => {
  const config = createCalendarAutomation({ entity_id: 'calendar.family', calendar_name: 'Familie' }, 'scene.x', 'calendar', 'start', 0);
  assert.deepEqual(config.conditions, []);
  assert.equal(config.alias, 'Famalio · Familie');
  assert.equal(ruleMatchesEvent(automationRule(config), { summary: 'Anything' }), true);
});

test('builder accepts any HA action with targets and data', () => {
  const actions = normalizeActions([{ action: 'notify.mobile_app_phone', data: { message: 'Los geht es' } },
    { action: 'light.turn_on', target: { entity_id: ['light.a', 'light.b'] }, data: { brightness_pct: 40 } }]);
  assert.deepEqual(actions[0], { action: 'notify.mobile_app_phone', data: { message: 'Los geht es' } });
  assert.deepEqual(actions[1].target, { entity_id: ['light.a', 'light.b'] });
  assert.throws(() => normalizeActions({ action: 'not a service' }));
  assert.throws(() => normalizeActions('bad id'));
});

test('action data accepts JSON or simple key/value lines', () => {
  assert.deepEqual(parseActionData('{"message":"Hi"}'), { message: 'Hi' });
  assert.deepEqual(parseActionData('brightness_pct: 40\nflash: true\ntitle: "Hallo: Welt"'), { brightness_pct: 40, flash: true, title: 'Hallo: Welt' });
  assert.deepEqual(parseActionData(''), {});
  assert.throws(() => parseActionData('[1,2]'));
  assert.throws(() => parseActionData('no colon here'));
});

test('stored rules round-trip into event badges for every scope', () => {
  const event = { entity_id: 'calendar.family', summary: 'Schwimmen', uid: 'u1', start: '2026-10-02T15:00:00Z' };
  const other = { summary: 'Schwimmen', uid: 'u1', start: '2026-10-09T15:00:00Z' };
  const occ = automationRule(createCalendarAutomation(event, 'scene.x', 'occurrence', 'start', 0));
  assert.equal(ruleMatchesEvent(occ, event), true);
  assert.equal(ruleMatchesEvent(occ, other), false);
  const title = automationRule(createCalendarAutomation(event, 'scene.x', 'title', 'start', 0));
  assert.equal(ruleMatchesEvent(title, other), true);
  assert.equal(ruleMatchesEvent(title, { summary: 'Schwimmen Kurs' }), false);
  const legacy = automationRule(createCalendarAutomation(event, 'scene.x', 'activity', 'start', 0));
  assert.equal(legacy.scope, 'title');
  assert.equal(automationRule({ conditions: [{ condition: 'state', entity_id: 'x' }] }), null);
  assert.deepEqual(automationRule({ triggers: [] }), { scope: 'calendar' });
});

test('editor converts wall-clock times into offset timestamps across DST', () => {
  assert.equal(zonedISO('2026-07-01', '09:30', 'Europe/Vienna'), '2026-07-01T09:30:00+02:00');
  assert.equal(zonedISO('2026-12-01', '09:30', 'Europe/Vienna'), '2026-12-01T09:30:00+01:00');
  const timed = editorEvent({ summary: ' Arzt ', allDay: false, startDate: '2026-10-02', startTime: '08:00', endDate: '2026-10-02', endTime: '09:00' }, 'Europe/Vienna');
  assert.deepEqual(timed, { summary: 'Arzt', dtstart: '2026-10-02T08:00:00+02:00', dtend: '2026-10-02T09:00:00+02:00' });
  const allDay = editorEvent({ summary: 'Urlaub', allDay: true, startDate: '2026-10-02', endDate: '2026-10-04', location: 'See' });
  assert.deepEqual(allDay, { summary: 'Urlaub', dtstart: '2026-10-02', dtend: '2026-10-05', location: 'See' });
  assert.throws(() => editorEvent({ summary: 'x', allDay: false, startDate: '2026-10-02', startTime: '09:00', endDate: '2026-10-02', endTime: '08:00' }));
  assert.throws(() => editorEvent({ summary: '', allDay: true, startDate: '2026-10-02', endDate: '2026-10-02' }));
});

test('write buttons follow the entity feature bits', () => {
  assert.equal(canWrite({ attributes: { supported_features: 7 } }, FEATURE.UPDATE), true);
  assert.equal(canWrite({ attributes: { supported_features: 0 } }, FEATURE.CREATE), false);
  assert.equal(canWrite(undefined, FEATURE.DELETE), false);
});

test('named shifts and free-day lists match exact names without substring false positives', () => {
  const event = { entity_id: 'calendar.shifts', summary: 'Tagschicht', start: '2026-10-05T06:00:00+02:00' };
  const shift = automationRule(createCalendarAutomation(event, 'automation.evening', 'titles', 'start', 0, 'Tagschicht\nTagdienst\nDay shift'));
  assert.equal(ruleMatchesEvent(shift, { ...event, summary: 'TAGSCHICHT' }), true);
  assert.equal(ruleMatchesEvent(shift, { ...event, summary: 'Tagschicht abgesagt' }), false);
  const free = automationRule(createCalendarAutomation(event, 'scene.free', 'titles', 'start', 0, 'Frei\nFree day\nDay off\nFrei'));
  assert.deepEqual(free.titles, ['Frei', 'Free day', 'Day off']);
  assert.equal(ruleMatchesEvent(free, { ...event, summary: 'frei' }), true);
  assert.equal(ruleMatchesEvent(free, { ...event, summary: 'Freitag' }), false);
  assert.throws(() => createCalendarAutomation(event, 'scene.free', 'titles', 'start', 0, '\n '));
});

test('description, location and day-type rules round-trip, including missing details', () => {
  const event = { entity_id: 'calendar.family', summary: 'Meeting', start: '2026-10-05T06:00:00Z', description: 'Team A #work', location: 'Bozen' };
  for (const [scope, value] of [['description', '#WORK'], ['location', 'bozen']]) {
    const rule = automationRule(createCalendarAutomation(event, 'scene.x', scope, 'start', 0, value));
    assert.equal(ruleMatchesEvent(rule, event), true);
    assert.equal(ruleMatchesEvent(rule, { ...event, [scope]: null }), false);
  }
  for (const scope of ['all_day', 'timed']) {
    const rule = automationRule(createCalendarAutomation(event, 'scene.x', scope, 'start', 0));
    assert.equal(ruleMatchesEvent(rule, event), scope === 'timed');
    assert.equal(ruleMatchesEvent(rule, { ...event, start: '2026-10-05', all_day: true }), scope === 'all_day');
  }
});

test('weekday and time filters follow event start in HA timezone across midnight and DST', () => {
  const event = { entity_id: 'calendar.family', summary: 'Tagschicht', start: '2026-10-04T22:30:00Z' }; // Monday 00:30 in Rome
  const config = createCalendarAutomation(event, 'scene.x', 'calendar', 'before_start', 60, '', { zone: 'Europe/Rome', weekdays: [0], startAfter: '22:00', startBefore: '02:00' });
  const rule = automationRule(config);
  assert.equal(ruleMatchesEvent(rule, event), true);
  assert.equal(ruleMatchesEvent(rule, { ...event, start: '2026-10-05T05:00:00Z' }), false);
  assert.equal(ruleMatchesEvent(rule, { ...event, start: '2026-10-03T22:30:00Z' }), false);
  assert.match(config.conditions[0].value_template, /trigger.calendar_event.start/);
  assert.doesNotMatch(config.conditions[0].value_template, /now\(/);
  const daylight = automationRule(createCalendarAutomation(event, 'scene.x', 'calendar', 'start', 0, '', { zone: 'Europe/Rome', startAfter: '06:00', startBefore: '08:00' }));
  assert.equal(ruleMatchesEvent(daylight, { ...event, start: '2026-10-24T04:30:00Z' }), true);
  assert.equal(ruleMatchesEvent(daylight, { ...event, start: '2026-10-26T04:30:00Z' }), false);
});

test('all-day weekday/time filters use local midnight without UTC date shifts', () => {
  const event = { entity_id: 'calendar.family', summary: 'Frei', start: '2026-10-05', all_day: true };
  const rule = automationRule(createCalendarAutomation(event, 'scene.x', 'all_day', 'start', 0, '', { zone: 'America/Los_Angeles', weekdays: [0], startBefore: '01:00' }));
  assert.equal(ruleMatchesEvent(rule, event), true);
  assert.equal(ruleMatchesEvent(rule, { ...event, start: '2026-10-06' }), false);
});

test('exclusions and state values remain encoded data in generated conditions', () => {
  const injected = `Cancelled }} {% set x = 1 %} 🥐`;
  const event = { entity_id: 'calendar.family', summary: 'Tagschicht', start: '2026-10-05T06:00:00Z' };
  const config = createCalendarAutomation(event, 'scene.x', 'calendar', 'start', 0, '', { exclude: injected + '\nAbgesagt', entity: 'person.ada', state: 'home' });
  assert.doesNotMatch(JSON.stringify(config.conditions), /Cancelled|set x|Abgesagt|home/);
  assert.equal(config.variables.famalio_filters.state_b64, b64('home'));
  const rule = automationRule(config);
  assert.equal(ruleMatchesEvent(rule, { ...event, summary: 'Tagschicht ABGESAGT' }), false);
  assert.equal(ruleMatchesEvent(rule, event), true);
  assert.throws(() => createCalendarAutomation(event, 'scene.x', 'calendar', 'start', 0, '', { entity: 'bad id', state: 'on' }));
});

test('empty-day automation queries the full local day and guards missing/unavailable results', () => {
  const config = createCalendarAutomation({ entity_id: 'calendar.family' }, 'automation.evening', 'empty_day', 'start', 0, '', { weekdays: [0, 1, 2, 3, 4], dailyTime: '07:30' });
  assert.deepEqual(config.triggers, [{ trigger: 'time', at: '07:30' }]);
  assert.equal(config.actions[0].action, 'calendar.get_events');
  assert.equal(config.actions[0].response_variable, 'famalio_day');
  assert.match(config.actions[0].data.start_date_time, /today_at\('00:00'\)/);
  assert.match(config.actions[0].data.end_date_time, /timedelta\(days=1\)/);
  assert.match(config.actions[1].value_template, /has_value/);
  assert.match(config.actions[1].value_template, /events is defined/);
  assert.match(config.actions[1].value_template, /length == 0/);
  assert.equal(config.actions[2].action, 'automation.trigger');
  assert.equal(config.actions[2].data.skip_condition, false);
  assert.deepEqual(automationCalendarIDs(config, ['calendar.family']), ['calendar.family']);
  assert.equal(ruleMatchesEvent(automationRule(config), { summary: 'Frei', start: '2026-10-05' }), false);
  assert.deepEqual(automationCalendarIDs({ ...config, actions: [] }, ['calendar.family']), []);
});

test('invalid filters, calendars, times and empty actions are rejected before saving', () => {
  const event = { entity_id: 'calendar.family', summary: 'x' };
  for (const filters of [{ weekdays: [7] }, { weekdays: [0.5] }, { startAfter: '25:30' }, { dailyTime: 'wrong' }]) {
    assert.throws(() => createCalendarAutomation(event, 'scene.x', 'calendar', 'start', 0, '', filters));
  }
  assert.throws(() => createCalendarAutomation({ ...event, entity_id: 'light.x' }, 'scene.x', 'calendar', 'start', 0));
  assert.throws(() => createCalendarAutomation(event, [], 'calendar', 'start', 0));
  assert.throws(() => createCalendarAutomation(event, 'scene.x', 'calendar', 'arbitrary', 0));
});

test('all HA target types and multi-action sequences survive normalization', () => {
  const result = normalizeActions([
    { action: 'light.turn_on', target: { entity_id: ['light.a', 'light.b'], area_id: 'living_room', device_id: ['device'], label_id: 'evening', floor_id: 'upstairs' }, data: { brightness_pct: 30 } },
    'automation.evening',
    { action: 'notify.phone', data: { message: '{{ trigger.calendar_event.summary }}' } },
  ]);
  assert.deepEqual(result[0].target, { entity_id: ['light.a', 'light.b'], area_id: 'living_room', device_id: ['device'], label_id: 'evening', floor_id: 'upstairs' });
  assert.deepEqual(result[1], { action: 'automation.trigger', target: { entity_id: 'automation.evening' }, data: { skip_condition: false } });
  assert.equal(result[2].data.message, '{{ trigger.calendar_event.summary }}');
});

test('text comparisons behave the same for titles, notes and locations', () => {
  const event = { entity_id: 'calendar.family', summary: 'Tagschicht Team A', start: '2026-10-05T06:00:00Z', description: 'Tagschicht Team A', location: 'Tagschicht Team A' };
  for (const scope of ['keyword', 'description', 'location']) {
    for (const [mode, value, expected] of [['starts_with', 'TAG', true], ['starts_with', 'Team', false], ['ends_with', 'team a', true], ['ends_with', 'Tag', false], ['not_contains', 'Night', true], ['not_contains', 'schicht', false]]) {
      const config = createCalendarAutomation(event, 'scene.x', scope, 'start', 0, value, { matchMode: mode });
      assert.equal(ruleMatchesEvent(automationRule(config), event), expected, `${scope} ${mode} ${value}`);
      assert.doesNotMatch(JSON.stringify(config.conditions), /Night|team a|schicht/);
    }
  }
});

test('manually selected automation actions respect conditions unless explicitly overridden', () => {
  assert.deepEqual(normalizeActions({ action: 'automation.trigger', target: { entity_id: 'automation.x' } })[0].data, { skip_condition: false });
  assert.deepEqual(normalizeActions({ action: 'automation.trigger', data: { skip_condition: true } })[0].data, { skip_condition: true });
});
