const { toClientCalendarId } = require('./calendarIds');

function parseMaterializedRecurringInstanceId(username, id) {
  const clientId = toClientCalendarId(username, id);
  const match = String(clientId || '').match(/^(.+)_(\d{9,12})$/);
  if (!match) return null;

  const occurrenceStart = Number(match[2]);
  if (!Number.isFinite(occurrenceStart) || occurrenceStart <= 0) {
    return null;
  }

  return {
    parentId: match[1],
    occurrenceStart
  };
}

function filterMaterializedRecurringInstanceEvents(username, events) {
  if (!Array.isArray(events) || events.length === 0) {
    return events || [];
  }

  const recurringMasterIds = new Set();
  events.forEach(event => {
    if (!event?.id || !event.recurrence) return;
    recurringMasterIds.add(String(event.id));
    recurringMasterIds.add(String(toClientCalendarId(username, event.id)));
  });

  if (recurringMasterIds.size === 0) {
    return events;
  }

  return events.filter(event => {
    if (!event?.id || event.recurrence) return true;
    const instance = parseMaterializedRecurringInstanceId(username, event.id);
    return !instance || !recurringMasterIds.has(instance.parentId);
  });
}

function getAllDayDateKey(event) {
  if (!event?.startTime) return '';
  const date = new Date(event.startTime * 1000);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function normalizeHolidayTitle(title) {
  return String(title || '').replace(/[（(]休[）)]$/, '').trim();
}

function filterSubscriptionHolidayDuplicates(events) {
  if (!Array.isArray(events) || events.length === 0) {
    return events || [];
  }

  const holidayRestKeys = new Set();
  events.forEach(event => {
    if (!event?.subscriptionId || !event.title || !/[（(]休[）)]$/.test(event.title)) return;
    const baseTitle = normalizeHolidayTitle(event.title);
    const dateKey = getAllDayDateKey(event);
    if (!baseTitle || !dateKey) return;
    holidayRestKeys.add(`${event.subscriptionId}|${dateKey}|${baseTitle}`);
  });

  if (holidayRestKeys.size === 0) {
    return events;
  }

  return events.filter(event => {
    if (!event?.subscriptionId || !event.title || /[（(]休[）)]$/.test(event.title)) return true;
    const baseTitle = normalizeHolidayTitle(event.title);
    const dateKey = getAllDayDateKey(event);
    return !holidayRestKeys.has(`${event.subscriptionId}|${dateKey}|${baseTitle}`);
  });
}

function filterCalendarDisplayEvents(username, events) {
  return filterSubscriptionHolidayDuplicates(
    filterMaterializedRecurringInstanceEvents(username, events)
  );
}

module.exports = {
  filterCalendarDisplayEvents,
  filterMaterializedRecurringInstanceEvents,
  filterSubscriptionHolidayDuplicates,
  parseMaterializedRecurringInstanceId
};
