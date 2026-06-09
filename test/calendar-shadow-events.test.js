const test = require('node:test');
const assert = require('node:assert/strict');

const { scopeExternalCalendarId } = require('../src/utils/calendarIds');
const {
  filterCalendarDisplayEvents,
  filterMaterializedRecurringInstanceEvents,
  filterSubscriptionHolidayDuplicates,
  parseMaterializedRecurringInstanceId
} = require('../src/utils/calendarShadowEvents');

test('parses scoped materialized recurring instance ids', () => {
  const id = scopeExternalCalendarId('snowfly', 'mouva25h67yc96ze5uc_1780876800');

  assert.deepEqual(parseMaterializedRecurringInstanceId('snowfly', id), {
    parentId: 'mouva25h67yc96ze5uc',
    occurrenceStart: 1780876800
  });
});

test('filters CalDAV materialized instances when their recurring master is present', () => {
  const shadowId = scopeExternalCalendarId('snowfly', 'mouva25h67yc96ze5uc_1780876800');
  const events = [
    {
      id: 'mouva25h67yc96ze5uc',
      title: '妈妈生日',
      recurrence: '{"type":"lunar_yearly"}',
      startTime: 1780876800
    },
    {
      id: shadowId,
      title: '妈妈生日',
      recurrence: null,
      startTime: 1780876800
    }
  ];

  assert.deepEqual(
    filterMaterializedRecurringInstanceEvents('snowfly', events).map(event => event.id),
    ['mouva25h67yc96ze5uc']
  );
});

test('keeps underscore ids when there is no matching recurring master', () => {
  const shadowId = scopeExternalCalendarId('snowfly', 'mouva25h67yc96ze5uc_1780876800');
  const events = [
    {
      id: shadowId,
      title: '妈妈生日',
      recurrence: null,
      startTime: 1780876800
    }
  ];

  assert.deepEqual(
    filterMaterializedRecurringInstanceEvents('snowfly', events).map(event => event.id),
    [shadowId]
  );
});

test('filters holiday subscription day events when rest-range event exists on the same day', () => {
  const startTime = Math.floor(Date.UTC(2026, 5, 19) / 1000);
  const events = [
    {
      id: 'sub_cn_idx_125',
      title: '端午节',
      subscriptionId: 'cn',
      startTime,
      allDay: 1
    },
    {
      id: 'sub_cn_idx_126',
      title: '端午节（休）',
      subscriptionId: 'cn',
      startTime,
      allDay: 1
    }
  ];

  assert.deepEqual(
    filterSubscriptionHolidayDuplicates(events).map(event => event.title),
    ['端午节（休）']
  );
});

test('keeps same-title holiday events from different subscriptions', () => {
  const startTime = Math.floor(Date.UTC(2026, 5, 19) / 1000);
  const events = [
    {
      id: 'sub_local_idx_1',
      title: '端午节',
      subscriptionId: 'local',
      startTime,
      allDay: 1
    },
    {
      id: 'sub_cn_idx_126',
      title: '端午节（休）',
      subscriptionId: 'cn',
      startTime,
      allDay: 1
    }
  ];

  assert.deepEqual(
    filterCalendarDisplayEvents('snowfly', events).map(event => event.title),
    ['端午节', '端午节（休）']
  );
});
