import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EN, translate, currentLanguage } from '../../famalio_home/wizard/public/i18n.js';

const read = (name) => readFileSync(new URL(`../public/${name}`, import.meta.url), 'utf8');
const GERMAN = /[äöüÄÖÜß]|\b(und|oder|die|der|das|nicht|Bitte|Tippe|wird|ist|Neue|Keine|Alle|Heute|Woche|Monat|Termin|Kalender|Verbindung|Fehler|Warte|Speicher|Bearbeit|Lösch|Schließ|Zugang|Schritt|Einrichtung|Wir|Dein|Deine|Öffne|Famalio-App)\b/;
const DYNAMIC = /\$\{/;

function htmlTexts() {
  const html = read('index.html').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '');
  const texts = [...html.matchAll(/>([^<>]+)</g)].map((m) => m[1].replace(/\s+/g, ' ').trim());
  const attrs = [...html.matchAll(/\b(?:placeholder|aria-label|title|alt)="([^"]+)"/g)].map((m) => m[1]);
  return [...texts, ...attrs].filter((t) => t && /[A-Za-zÄÖÜäöüß]{3}/.test(t) && GERMAN.test(t));
}

function scriptTexts() {
  const found = new Set();
  for (const file of ['wizard.js', 'calendar.js', 'calendar-helpers.js']) {
    for (const m of read(file).matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'/g)) {
      const t = m[1] ?? m[2];
      if (t && t.length > 3 && GERMAN.test(t) && !DYNAMIC.test(t) && /^[A-ZÄÖÜ„✓＋·]/.test(t) && !/[=<>{}/]/.test(t.replace(/„|“|→/g, ''))) found.add(t);
    }
  }
  return [...found];
}

const known = (t) => translate(t, 'en') !== t || EN[t.trim()] !== undefined;

test('every German text in the page has an English version', () => {
  const missing = htmlTexts().filter((t) => !known(t));
  assert.deepEqual(missing, []);
});

test('every German message the scripts can show has an English version', () => {
  const missing = scriptTexts().filter((t) => !known(t));
  assert.deepEqual(missing, []);
});

test('texts with a changing part keep that part', () => {
  assert.equal(translate('3 Kalender verbunden', 'en'), '3 calendars connected');
  assert.equal(translate('1 Kalender verbunden', 'en'), '1 calendar connected');
  assert.equal(translate('Alle „Frühschicht“', 'en'), 'All “Frühschicht”');
  assert.equal(translate('„Zahnarzt“ wirklich löschen?', 'en'), 'Really delete “Zahnarzt”?');
  assert.equal(translate('Licht auswählen …', 'en'), 'Choose light …');
});

test('German stays German and unknown text is never changed', () => {
  assert.equal(translate('Zugang einrichten', 'de'), 'Zugang einrichten');
  assert.equal(translate('Etwas ganz Neues', 'en'), 'Etwas ganz Neues');
  assert.equal(translate('  Heute  ', 'en'), '  Today  ');
});

test('language: query beats stored choice beats browser', () => {
  assert.equal(currentLanguage('?lang=en', 'de', 'de-DE'), 'en');
  assert.equal(currentLanguage('', 'en', 'de-DE'), 'en');
  assert.equal(currentLanguage('', null, 'de-AT'), 'de');
  assert.equal(currentLanguage('', null, 'en-GB'), 'en');
  assert.equal(currentLanguage('', null, 'it-IT'), 'en');
});

test('no English text contains German leftovers', () => {
  for (const [german, english] of Object.entries(EN)) {
    assert.ok(english.length > 0, german);
    assert.doesNotMatch(english, /[äöüß]/, `${german} -> ${english}`);
  }
});

test('English server messages are shown in German; German and unknown text stay unchanged', async () => {
  const { fromServer, SERVER_DE } = await import('../../famalio_home/wizard/public/i18n.js');
  assert.equal(fromServer('The request expired. Start a new one.'), 'Die Anfrage ist abgelaufen. Sende eine neue Anfrage.');
  assert.equal(fromServer('HTTPS verification returned 502'), 'Die HTTPS-Prüfung antwortete mit Fehler 502.');
  assert.equal(fromServer('  Not found.\n'), '  Nicht gefunden.\n');
  assert.equal(fromServer('Schritt 1: Zugang einrichten'), 'Schritt 1: Zugang einrichten');
  assert.equal(fromServer(undefined), undefined);
  for (const [english, german] of Object.entries(SERVER_DE)) assert.ok(german && german !== english, english);
});
