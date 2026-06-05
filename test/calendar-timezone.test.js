const test = require('node:test');
const assert = require('node:assert/strict');

const ICalGenerator = require('../src/utils/icalGenerator');
const ICalParser = require('../src/utils/icalParser');
const { importFromICS } = require('../src/utils/icsExport');
const TimeHelper = require('../src/utils/timeHelper');
const { formatICSDateTime, parseICSDate } = require('../src/utils/icalShared');

test('parses TZID values without uppercasing the timezone name', () => {
  const calendar = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    'UID:ny-summer',
    'DTSTART;TZID=America/New_York:20260701T090000',
    'DTEND;TZID=America/New_York:20260701T100000',
    'SUMMARY:Summer meeting',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');

  const parsed = ICalParser.parse(calendar);

  assert.equal(parsed.events.length, 1);
  assert.equal(parsed.events[0].timezone, 'America/New_York');
  assert.equal(parsed.events[0].startTime, Math.floor(Date.UTC(2026, 6, 1, 13, 0, 0) / 1000));
});

test('uses IANA daylight saving offsets when parsing timezone datetimes', () => {
  const summer = ICalParser.parseDateTime('20260701T090000', { TZID: 'America/New_York' });
  const winter = ICalParser.parseDateTime('20260101T090000', { TZID: 'America/New_York' });

  assert.equal(summer, Math.floor(Date.UTC(2026, 6, 1, 13, 0, 0) / 1000));
  assert.equal(winter, Math.floor(Date.UTC(2026, 0, 1, 14, 0, 0) / 1000));
});

test('exports non-all-day events with their persisted timezone', () => {
  const startTime = Math.floor(Date.UTC(2026, 6, 1, 13, 0, 0) / 1000);
  const ics = ICalGenerator.eventToICal({
    id: 'ny-export',
    title: 'Exported meeting',
    startTime,
    endTime: startTime + 3600,
    allDay: 0,
    timezone: 'America/New_York',
    updatedAt: startTime
  });

  assert.match(ics, /DTSTART;TZID=America\/New_York:20260701T090000/);
  assert.match(ics, /DTEND;TZID=America\/New_York:20260701T100000/);
});

test('exports all-day dates from stored UTC calendar dates', () => {
  const ics = ICalGenerator.eventToICal({
    id: 'all-day-utc',
    title: 'UTC date',
    startTime: Math.floor(Date.UTC(2026, 0, 1, 0, 0, 0) / 1000),
    endTime: Math.floor(Date.UTC(2026, 0, 2, 0, 0, 0) / 1000),
    allDay: 1,
    timezone: 'America/Los_Angeles'
  });

  assert.match(ics, /DTSTART;VALUE=DATE:20260101/);
  assert.match(ics, /DTEND;VALUE=DATE:20260102/);
});

test('subscription ICS import keeps TZID and DST-correct start time', () => {
  const events = importFromICS([
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    'UID:quoted-tz',
    'DTSTART;TZID="America/New_York":20260701T090000',
    'DTEND;TZID="America/New_York":20260701T100000',
    'SUMMARY:Subscription event',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n'));

  assert.equal(events.length, 1);
  assert.equal(events[0].timezone, 'America/New_York');
  assert.equal(events[0].startTime, Math.floor(Date.UTC(2026, 6, 1, 13, 0, 0) / 1000));
});

test('shared ICS parser and formatter use IANA DST offsets', () => {
  const ts = parseICSDate('DTSTART;TZID=America/New_York:20260701T090000');
  assert.equal(ts, Math.floor(Date.UTC(2026, 6, 1, 13, 0, 0) / 1000));

  const formatted = formatICSDateTime(new Date(ts * 1000), { timezone: 'America/New_York' });
  assert.equal(formatted, '20260701T090000');
});

test('time zone clock conversion handles DST instead of fixed offsets', () => {
  assert.equal(
    TimeHelper.toTimeZoneClockTs(2026, 7, 1, 9, 0, 0, 'America/New_York'),
    Math.floor(Date.UTC(2026, 6, 1, 13, 0, 0) / 1000)
  );
  assert.equal(
    TimeHelper.toTimeZoneClockTs(2026, 1, 1, 9, 0, 0, 'America/New_York'),
    Math.floor(Date.UTC(2026, 0, 1, 14, 0, 0) / 1000)
  );
});

test('RRULE UNTIL with Z remains UTC when imported', () => {
  const recurrence = ICalParser.parseRRULE('FREQ=DAILY;UNTIL=20260701T130000Z');

  assert.equal(recurrence.recurrenceEnd, Math.floor(Date.UTC(2026, 6, 1, 13, 0, 0) / 1000));
});

test('all-day floating datetime inputs normalize by calendar date, not server timezone', () => {
  const normalized = TimeHelper.normalizeAllDayRange('2026-01-01T00:00', '2026-01-01T23:59');

  assert.equal(normalized.startTime, Math.floor(Date.UTC(2026, 0, 1, 0, 0, 0) / 1000));
  assert.equal(normalized.endTime, Math.floor(Date.UTC(2026, 0, 2, 0, 0, 0) / 1000));
});
