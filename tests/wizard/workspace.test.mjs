import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../../famalio_home/wizard/public/workspace.js', import.meta.url), 'utf8');
function workspace(hash = '') {
  const listeners = new Map();
  const elements = new Map();
  for (const id of ['calendar-workspace', 'settings-workspace', 'nav-calendar', 'nav-settings']) {
    elements.set(id, { hidden: false, attributes: {}, handlers: {}, addEventListener(type, fn) { this.handlers[type] = fn; },
      toggleAttribute(key, active) { if (active) this.attributes[key] = ''; else delete this.attributes[key]; },
      setAttribute(key, value) { this.attributes[key] = value; }, focus() {} });
  }
  const location = { hash };
  const dispatch = (type, detail) => { for (const fn of listeners.get(type) || []) fn({ detail }); };
  const window = { addEventListener(type, fn) { listeners.set(type, [...(listeners.get(type) || []), fn]); }, dispatchEvent(event) { dispatch(event.type, event.detail); } };
  const document = { getElementById: (id) => elements.get(id), addEventListener() {} };
  vm.runInNewContext(source, { window, document, location, history: { replaceState(_state, _title, hash) { location.hash = hash; } }, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } } });
  return { elements, location, dispatch, page: () => elements.get('calendar-workspace').hidden ? 'settings' : 'calendar' };
}

test('new installation opens setup until HA actually registers a calendar', () => {
  const ui = workspace();
  assert.equal(ui.page(), 'settings');
  ui.dispatch('famalio-calendar-state', 'setup');
  ui.dispatch('famalio-calendar-state', 'discovered');
  assert.equal(ui.page(), 'settings');
  ui.dispatch('famalio-calendar-state', 'ready');
  assert.equal(ui.page(), 'calendar');
  assert.equal(ui.location.hash, '#calendar');
  assert.equal(ui.elements.get('nav-calendar').attributes['aria-current'], 'page');
  assert.equal(ui.elements.get('nav-settings').attributes['aria-current'], undefined);
});

test('configured installation opens calendar and preserves deliberate setup navigation', () => {
  const ui = workspace();
  ui.dispatch('famalio-calendar-state', 'ready');
  assert.equal(ui.page(), 'calendar');
  ui.elements.get('nav-settings').handlers.click();
  ui.dispatch('hashchange');
  ui.dispatch('famalio-calendar-state', 'ready');
  assert.equal(ui.page(), 'settings');
});

test('explicit setup and step links remain open on an already configured installation', () => {
  for (const hash of ['#settings', '#step-network-title']) {
    const ui = workspace(hash);
    ui.dispatch('famalio-calendar-state', 'ready');
    assert.equal(ui.page(), 'settings');
  }
});

test('setup confirmation switches an explicitly opened incomplete setup to calendar', () => {
  const ui = workspace('#settings');
  ui.dispatch('famalio-calendar-state', 'setup');
  ui.dispatch('famalio-calendar-state', 'ready');
  assert.equal(ui.page(), 'calendar');
});

test('explicit calendar can show connection errors without being forced to setup', () => {
  const ui = workspace('#calendar');
  ui.dispatch('famalio-calendar-state', 'setup');
  assert.equal(ui.page(), 'calendar');
});
