const db = require('../db/client');
const log = require('../utils/logger');
const TimeHelper = require('../utils/timeHelper');
const lunarHelper = require('../utils/lunarHelper');
const {
  generateRecurringEvents,
  parseExcludedDates,
  getNextRecurringOccurrenceStart
} = require('../utils/recurringEvents');
const { getCalendarIdCandidates, scopeExternalCalendarId, toClientCalendarId } = require('../utils/calendarIds');
const { normalizeReminderPreset } = require('../utils/reminderPresets');
const { mapTodoForClient, mapEventForClient } = require('../utils/calendarClientMapper');
const { filterCalendarDisplayEvents } = require('../utils/calendarShadowEvents');
const { insertDeletedItem } = require('../utils/deletedItems');
const ICalGenerator = require('../utils/icalGenerator');
const ICalParser = require('../utils/icalParser');
const { ensureItemQuotaAvailable, getItemQuotaState } = require('./itemQuotaService');

function normalizeEventRange(startTime, endTime, allDay) {
  if (allDay) {
    return TimeHelper.normalizeAllDayRange(startTime, endTime);
  }

  return {
    startTime: TimeHelper.parseToTs(startTime),
    endTime: TimeHelper.parseToTs(endTime)
  };
}

function normalizeEventTimezone(timezone) {
  return TimeHelper.normalizeTimeZone(timezone, null) || null;
}

function expandRecurringInstancesForRange(event, startDate, endDate) {
  const recurrence = typeof event.recurrence === 'string' ? JSON.parse(event.recurrence) : event.recurrence;
  if (!recurrence || !recurrence.type) return [];

  const instances = generateRecurringEvents({ ...event, recurrence }, startDate, endDate);
  return instances.map(instance => ({
    ...instance,
    _originalId: instance.parentEventId || event.id
  }));
}

function normalizeOccurrenceStartTime(value) {
  const ts = Number(value);
  return Number.isFinite(ts) && ts > 0 ? Math.floor(ts) : null;
}

function serializeExcludedDates(values) {
  const sorted = Array.from(values)
    .map(v => Number(v))
    .filter(v => Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);
  return sorted.length > 0 ? JSON.stringify(sorted) : null;
}

function buildEventId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

async function getEventByCandidates(username, id, fields = '*') {
  const candidates = getCalendarIdCandidates(username, id);
  const placeholders = candidates.map(() => '?').join(',');
  return db.queryOne(
    `SELECT ${fields} FROM events WHERE username = ? AND id IN (${placeholders}) LIMIT 1`,
    [username, ...candidates]
  );
}

async function createBatchEvents(username, events) {
  const now = Math.floor(Date.now() / 1000);
  return db.withTransaction(async (tx) => {
    const creatableCount = events.reduce((count, event) => {
      if (!event?.title) return count;
      const normalizedRange = normalizeEventRange(event.startTime, event.endTime, event.allDay);
      return normalizedRange.startTime ? count + 1 : count;
    }, 0);

    await ensureItemQuotaAvailable(username, 'event', creatableCount, tx);

    let count = 0;
    for (const event of events) {
      const { title, description, startTime, endTime, allDay, timezone } = event;
      if (!title) continue;

      const normalizedRange = normalizeEventRange(startTime, endTime, allDay);
      if (!normalizedRange.startTime) continue;

      await tx.execute(
        `INSERT INTO events (id, username, title, description, startTime, endTime, allDay, color, timezone, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          buildEventId(),
          username,
          title.trim(),
          description || '',
          normalizedRange.startTime,
          normalizedRange.endTime,
          allDay ? 1 : 0,
          '#2563eb',
          normalizeEventTimezone(timezone),
          now,
          now
        ]
      );
      count++;
    }
    return count;
  });
}

async function listEvents(username, startDate, endDate) {
  let query = 'SELECT * FROM events WHERE username = ?';
  const params = [username];

  if (startDate && endDate) {
    query += ` AND (
      (recurrence IS NOT NULL AND recurrence != '')
      OR
      (startTime <= ? AND (endTime > ? OR endTime IS NULL))
    )`;
    params.push(parseInt(endDate, 10), parseInt(startDate, 10));
  }

  const events = await db.queryAll(query, params);
  return filterCalendarDisplayEvents(username, events)
    .map(event => mapEventForClient(username, event));
}

async function deleteBatchEvents(username, { ids, startTime, endTime, all }) {
  const now = Math.floor(Date.now() / 1000);

  if (all === true) {
    await db.withTransaction(async (tx) => {
      const items = await tx.queryAll('SELECT id FROM events WHERE username = ?', [username]);
      for (const item of items) {
        await insertDeletedItem(tx, {
          username,
          itemId: item.id,
          type: 'event',
          deletedAt: now
        });
      }
      await tx.execute('DELETE FROM events WHERE username = ?', [username]);
    });
    return;
  }

  if (startTime && endTime) {
    await db.withTransaction(async (tx) => {
      const items = await tx.queryAll(
        'SELECT id FROM events WHERE username = ? AND startTime >= ? AND startTime <= ?',
        [username, startTime, endTime]
      );
      for (const item of items) {
        await insertDeletedItem(tx, {
          username,
          itemId: item.id,
          type: 'event',
          deletedAt: now
        });
      }
      await tx.execute(
        'DELETE FROM events WHERE username = ? AND startTime >= ? AND startTime <= ?',
        [username, startTime, endTime]
      );
    });
    return;
  }

  if (Array.isArray(ids) && ids.length > 0) {
    const candidateIds = [...new Set(ids.flatMap(id => getCalendarIdCandidates(username, id)))];
    const placeholders = candidateIds.map(() => '?').join(',');
    await db.withTransaction(async (tx) => {
      const items = await tx.queryAll(
        `SELECT id FROM events WHERE username = ? AND id IN (${placeholders})`,
        [username, ...candidateIds]
      );
      for (const item of items) {
        await insertDeletedItem(tx, {
          username,
          itemId: item.id,
          type: 'event',
          deletedAt: now
        });
      }
      await tx.execute(
        `DELETE FROM events WHERE username = ? AND id IN (${placeholders})`,
        [username, ...candidateIds]
      );
    });
    return;
  }

  throw new Error('INVALID_DELETE_REQUEST');
}

async function expandLunarEvents(username, start, end) {
  const lunarMasters = await db.queryAll(
    "SELECT * FROM events WHERE username = ? AND recurrence LIKE '%lunar_%'",
    [username]
  );

  const expanded = [];
  for (const master of lunarMasters) {
    expanded.push(...lunarHelper.generateLunarRecurringEvents(master, start, end));
  }

  return expanded.map(event => mapEventForClient(username, event));
}

async function expandRecurringEventsForUser(username, start, end) {
  const masters = await db.queryAll(
    "SELECT * FROM events WHERE username = ? AND recurrence IS NOT NULL AND recurrence != ''",
    [username]
  );

  const expanded = [];
  for (const master of masters) {
    try {
      expanded.push(...expandRecurringInstancesForRange(master, start, end));
    } catch (error) {
      log('WARN', '展开重复事件失败', { username, eventId: master.id, error: error.message });
    }
  }

  return expanded.map(event => mapEventForClient(username, event));
}

async function formatUserEvents(username) {
  const events = await db.queryAll('SELECT * FROM events WHERE username = ?', [username]);
  return db.withTransaction(async (tx) => {
    let count = 0;
    for (const event of events) {
      let needsUpdate = false;
      let newStart = event.startTime;
      let newEnd = event.endTime;

      if (event.allDay === 1) {
        const normalizedRange = TimeHelper.normalizeAllDayRange(event.startTime, event.endTime);
        if (normalizedRange.startTime !== event.startTime) {
          newStart = normalizedRange.startTime;
          needsUpdate = true;
        }
        if (normalizedRange.endTime !== event.endTime) {
          newEnd = normalizedRange.endTime;
          needsUpdate = true;
        }
      } else {
        newStart = TimeHelper.parseToTs(event.startTime);
        newEnd = TimeHelper.parseToTs(event.endTime);
        if (newStart !== event.startTime || newEnd !== event.endTime) {
          needsUpdate = true;
        }
      }

      const cleanId = event.id.replace(/[<>&'"]/g, '');
      let finalId = event.id;
      if (cleanId !== event.id) {
        finalId = cleanId;
        needsUpdate = true;
      }

      if (!needsUpdate) {
        continue;
      }

      await tx.execute(
        `UPDATE events SET id = ?, startTime = ?, endTime = ?, updatedAt = ? WHERE id = ? AND username = ?`,
        [finalId, newStart, newEnd, Math.floor(Date.now() / 1000), event.id, username]
      );
      count++;
    }
    return count;
  });
}

async function exportCalendar(username) {
  const [events, todos] = await Promise.all([
    db.queryAll('SELECT * FROM events WHERE username = ?', [username]),
    db.queryAll('SELECT * FROM todos WHERE username = ?', [username])
  ]);

  const exportedEvents = events.map(event => mapEventForClient(username, event));
  const exportedTodos = todos.map(todo => mapTodoForClient(username, todo));

  return ICalGenerator.generateCalendar(exportedEvents, exportedTodos, username, []);
}

async function importCalendar(username, icsContent) {
  const parsed = ICalParser.parse(icsContent);
  const now = Math.floor(Date.now() / 1000);
  let imported = 0;
  let skipped = 0;
  let updated = 0;

  await db.withTransaction(async (tx) => {
    const eventQuota = await getItemQuotaState(username, 'event', tx);
    const todoQuota = await getItemQuotaState(username, 'todo', tx);
    let nextEventCount = eventQuota.current;
    let nextTodoCount = todoQuota.current;

    for (const event of parsed.events) {
      const recurrenceStr = event.recurrence ? JSON.stringify(event.recurrence) : null;
      const normalizedRange = normalizeEventRange(event.startTime, event.endTime, event.allDay);
      if (!normalizedRange.startTime) {
        skipped++;
        continue;
      }

      let existing;
      const scopedEventId = event.id ? scopeExternalCalendarId(username, event.id) : null;
      if (event.id) {
        existing = await tx.queryOne(
          'SELECT id, subscriptionId FROM events WHERE id IN (?, ?) AND username = ?',
          [event.id, scopedEventId, username]
        );
      }

      if (!existing && event.title && event.startTime) {
        existing = await tx.queryOne(
          'SELECT id, subscriptionId FROM events WHERE username = ? AND title = ? AND startTime = ?',
          [username, event.title, event.startTime]
        );
      }

      if (existing) {
        if (existing.subscriptionId) {
          skipped++;
          continue;
        }

        await tx.execute(
          'UPDATE events SET title=?, description=?, startTime=?, endTime=?, allDay=?, color=?, timezone=?, recurrence=?, recurrenceEnd=?, updatedAt=? WHERE id=? AND username=?',
          [
            event.title,
            event.description || '',
            normalizedRange.startTime,
            normalizedRange.endTime,
            event.allDay ? 1 : 0,
            event.color || '#2563eb',
            normalizeEventTimezone(event.timezone),
            recurrenceStr,
            TimeHelper.parseToTs(event.recurrenceEnd),
            now,
            existing.id,
            username
          ]
        );
        updated++;
      } else {
        if (eventQuota.limit > 0 && nextEventCount + 1 > eventQuota.limit) {
          const error = new Error('ITEM_QUOTA_EXCEEDED');
          error.type = 'event';
          error.label = eventQuota.label;
          error.limit = eventQuota.limit;
          error.current = nextEventCount;
          error.incomingCount = 1;
          throw error;
        }
        const eventId = event.id ? scopedEventId : `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        await tx.execute(
          'INSERT INTO events (id, username, title, description, startTime, endTime, allDay, color, timezone, recurrence, recurrenceEnd, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
          [
            eventId,
            username,
            event.title,
            event.description || '',
            normalizedRange.startTime,
            normalizedRange.endTime,
            event.allDay ? 1 : 0,
            event.color || '#2563eb',
            normalizeEventTimezone(event.timezone),
            recurrenceStr,
            TimeHelper.parseToTs(event.recurrenceEnd),
            now,
            now
          ]
        );
        imported++;
        nextEventCount += 1;
      }
    }

    for (const todo of parsed.todos) {
      let existing;
      const scopedTodoId = todo.id ? scopeExternalCalendarId(username, todo.id) : null;
      if (todo.id) {
        existing = await tx.queryOne(
          'SELECT id FROM todos WHERE id IN (?, ?) AND username = ?',
          [todo.id, scopedTodoId, username]
        );
      }

      if (!existing && todo.title && todo.dueDate) {
        existing = await tx.queryOne(
          'SELECT id FROM todos WHERE username = ? AND title = ? AND dueDate = ?',
          [username, todo.title, todo.dueDate]
        );
      }

      if (existing) {
        await tx.execute(
          'UPDATE todos SET title=?, description=?, priority=?, dueDate=?, completed=?, updatedAt=? WHERE id=? AND username=?',
          [
            todo.title,
            todo.description || '',
            todo.priority || 5,
            todo.dueDate,
            todo.completed ? 1 : 0,
            now,
            existing.id,
            username
          ]
        );
        updated++;
        skipped++;
      } else {
        if (todoQuota.limit > 0 && nextTodoCount + 1 > todoQuota.limit) {
          const error = new Error('ITEM_QUOTA_EXCEEDED');
          error.type = 'todo';
          error.label = todoQuota.label;
          error.limit = todoQuota.limit;
          error.current = nextTodoCount;
          error.incomingCount = 1;
          throw error;
        }
        const todoId = todo.id ? scopedTodoId : `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        await tx.execute(
          'INSERT INTO todos (id, username, title, description, priority, dueDate, completed, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?)',
          [
            todoId,
            username,
            todo.title,
            todo.description || '',
            todo.priority || 5,
            todo.dueDate,
            todo.completed ? 1 : 0,
            now,
            now
          ]
        );
        imported++;
        nextTodoCount += 1;
      }
    }
  });

  return { imported, skipped, updated };
}

async function cleanupDuplicateEvents(username) {
  const duplicates = await db.queryAll(`
    SELECT title, startTime, endTime, recurrence, allDay, COUNT(*) as count
    FROM events
    WHERE username = ?
    GROUP BY title, startTime, endTime, COALESCE(recurrence, ''), allDay
    HAVING count > 1
  `, [username]);

  const now = Math.floor(Date.now() / 1000);
  const deletedCount = await db.withTransaction(async (tx) => {
    let count = 0;
    for (const dup of duplicates) {
      const items = await tx.queryAll(
        `SELECT id FROM events
         WHERE username = ? AND title = ? AND startTime = ?
         AND (endTime = ? OR (endTime IS NULL AND ? IS NULL))
         AND (recurrence = ? OR (recurrence IS NULL AND ? IS NULL))
         AND allDay = ?
         ORDER BY updatedAt DESC`,
        [username, dup.title, dup.startTime, dup.endTime, dup.endTime, dup.recurrence, dup.recurrence, dup.allDay]
      );

      const idsToDelete = items.slice(1).map(item => item.id);
      if (idsToDelete.length === 0) {
        continue;
      }

      for (const id of idsToDelete) {
        await insertDeletedItem(tx, {
          username,
          itemId: id,
          type: 'event',
          deletedAt: now
        });
      }

      const placeholders = idsToDelete.map(() => '?').join(',');
      await tx.execute(
        `DELETE FROM events WHERE username = ? AND id IN (${placeholders})`,
        [username, ...idsToDelete]
      );
      count += idsToDelete.length;
    }
    return count;
  });

  return { deletedCount };
}

async function createEvent(username, payload) {
  const {
    title,
    description,
    startTime,
    endTime,
    allDay,
    reminderEmail,
    reminderBrowser,
    reminderCaldav,
    reminderPreset,
    timezone,
    recurrence,
    recurrenceEnd
  } = payload;

  const normalizedRange = normalizeEventRange(startTime, endTime, allDay);
  if (!normalizedRange.startTime) {
    throw new Error('INVALID_START_TIME');
  }

  await ensureItemQuotaAvailable(username, 'event');

  const id = buildEventId();
  const now = Math.floor(Date.now() / 1000);
  await db.execute(
    `INSERT INTO events (id, username, title, description, startTime, endTime, allDay, color, timezone, reminderEmail, reminderBrowser, reminderCaldav, reminderPreset, recurrence, recurrenceEnd, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      username,
      title.trim(),
      description || '',
      normalizedRange.startTime,
      normalizedRange.endTime,
      allDay ? 1 : 0,
      '#2563eb',
      normalizeEventTimezone(timezone),
      reminderEmail ? 1 : 0,
      reminderBrowser ? 1 : 0,
      reminderCaldav ? 1 : 0,
      normalizeReminderPreset(reminderPreset, !!allDay),
      recurrence || null,
      TimeHelper.parseToTs(recurrenceEnd),
      now,
      now
    ]
  );

  return { id: toClientCalendarId(username, id), title };
}

async function updateEvent(username, rawId, payload) {
  const existing = await getEventByCandidates(username, rawId);
  if (!existing) {
    throw new Error('EVENT_NOT_FOUND');
  }

  const updates = [];
  const params = [];
  const fields = {
    title: value => value?.trim(),
    description: value => value,
    allDay: value => (value ? 1 : 0),
    reminderEmail: value => (value ? 1 : 0),
    reminderBrowser: value => (value ? 1 : 0),
    reminderCaldav: value => (value ? 1 : 0),
    timezone: normalizeEventTimezone,
    recurrence: value => value || null,
    recurrenceEnd: TimeHelper.parseToTs
  };

  for (const [key, parser] of Object.entries(fields)) {
    if (payload[key] === undefined) {
      continue;
    }
    updates.push(`${key} = ?`);
    params.push(parser(payload[key]));
  }

  if (payload.startTime !== undefined || payload.endTime !== undefined || payload.allDay !== undefined) {
    const normalizedRange = normalizeEventRange(
      payload.startTime !== undefined ? payload.startTime : existing.startTime,
      payload.endTime !== undefined ? payload.endTime : existing.endTime,
      payload.allDay !== undefined ? payload.allDay : existing.allDay
    );

    if (!normalizedRange.startTime) {
      throw new Error('INVALID_START_TIME');
    }

    updates.push('startTime = ?', 'endTime = ?');
    params.push(normalizedRange.startTime, normalizedRange.endTime);
  }

  if (payload.reminderPreset !== undefined || payload.allDay !== undefined) {
    updates.push('reminderPreset = ?');
    params.push(
      normalizeReminderPreset(
        payload.reminderPreset,
        payload.allDay !== undefined ? !!payload.allDay : !!existing.allDay
      )
    );
  }

  if (updates.length === 0) {
    return { success: true };
  }

  updates.push('updatedAt = ?');
  params.push(Math.floor(Date.now() / 1000), existing.id, username);

  await db.execute(
    `UPDATE events SET ${updates.join(', ')} WHERE id = ? AND username = ?`,
    params
  );

  return { success: true };
}

async function deleteEventScope(username, rawId, options = {}) {
  const event = await getEventByCandidates(username, rawId);
  if (!event) {
    throw new Error('EVENT_NOT_FOUND');
  }

  const recurrence = typeof event.recurrence === 'string' ? JSON.parse(event.recurrence) : event.recurrence;
  if (!recurrence || !recurrence.type) {
    throw new Error('NOT_RECURRING_EVENT');
  }

  const now = Math.floor(Date.now() / 1000);
  const normalizedOccurrenceStartTime = normalizeOccurrenceStartTime(options.occurrenceStartTime);

  let effectiveDeletePrevious = options.deletePrevious === true;
  let effectiveDeleteCurrent = options.deleteCurrent === true;
  let effectiveDeleteFuture = options.deleteFuture === true;

  if (
    options.deletePrevious === undefined &&
    options.deleteCurrent === undefined &&
    options.deleteFuture === undefined
  ) {
    if (options.scope === 'single') {
      effectiveDeleteCurrent = true;
    } else if (options.scope === 'future') {
      effectiveDeleteCurrent = true;
      effectiveDeleteFuture = true;
    } else if (options.scope === 'all') {
      effectiveDeletePrevious = true;
      effectiveDeleteCurrent = true;
      effectiveDeleteFuture = true;
    }
  }

  if (!effectiveDeletePrevious && !effectiveDeleteCurrent && !effectiveDeleteFuture) {
    throw new Error('INVALID_DELETE_SCOPE');
  }

  if (
    !(effectiveDeletePrevious && effectiveDeleteCurrent && effectiveDeleteFuture) &&
    !normalizedOccurrenceStartTime
  ) {
    throw new Error('MISSING_OCCURRENCE_START');
  }

  await db.withTransaction(async (tx) => {
    const deleteAll = effectiveDeletePrevious && effectiveDeleteCurrent && effectiveDeleteFuture;
    const duration = event.endTime ? Math.max(0, event.endTime - event.startTime) : 0;
    const excludedDates = parseExcludedDates(event.excludedDates);

    if (deleteAll) {
      await insertDeletedItem(tx, {
        username,
        itemId: event.id,
        type: 'event',
        deletedAt: now
      });
      await tx.execute('DELETE FROM events WHERE id = ? AND username = ?', [event.id, username]);
      return;
    }

    if (!effectiveDeletePrevious && effectiveDeleteCurrent && !effectiveDeleteFuture) {
      excludedDates.add(normalizedOccurrenceStartTime);
      await tx.execute(
        'UPDATE events SET excludedDates = ?, updatedAt = ? WHERE id = ? AND username = ?',
        [serializeExcludedDates(excludedDates), now, event.id, username]
      );
      return;
    }

    if (!effectiveDeletePrevious && !effectiveDeleteCurrent && effectiveDeleteFuture) {
      await tx.execute(
        'UPDATE events SET recurrenceEnd = ?, updatedAt = ? WHERE id = ? AND username = ?',
        [normalizedOccurrenceStartTime, now, event.id, username]
      );
      return;
    }

    if (!effectiveDeletePrevious && effectiveDeleteCurrent && effectiveDeleteFuture) {
      excludedDates.add(normalizedOccurrenceStartTime);
      await tx.execute(
        'UPDATE events SET recurrenceEnd = ?, excludedDates = ?, updatedAt = ? WHERE id = ? AND username = ?',
        [normalizedOccurrenceStartTime - 1, serializeExcludedDates(excludedDates), now, event.id, username]
      );
      return;
    }

    if (effectiveDeletePrevious && !effectiveDeleteCurrent && !effectiveDeleteFuture) {
      const keptExcludedDates = new Set(
        Array.from(excludedDates).filter(value => value >= normalizedOccurrenceStartTime)
      );
      await tx.execute(
        'UPDATE events SET startTime = ?, endTime = ?, excludedDates = ?, updatedAt = ? WHERE id = ? AND username = ?',
        [
          normalizedOccurrenceStartTime,
          duration > 0 ? normalizedOccurrenceStartTime + duration : event.endTime,
          serializeExcludedDates(keptExcludedDates),
          now,
          event.id,
          username
        ]
      );
      return;
    }

    if (effectiveDeletePrevious && effectiveDeleteCurrent && !effectiveDeleteFuture) {
      const nextOccurrenceStart = getNextRecurringOccurrenceStart(event, normalizedOccurrenceStartTime);
      if (!nextOccurrenceStart) {
        await insertDeletedItem(tx, {
          username,
          itemId: event.id,
          type: 'event',
          deletedAt: now
        });
        await tx.execute('DELETE FROM events WHERE id = ? AND username = ?', [event.id, username]);
        return;
      }

      const keptExcludedDates = new Set(
        Array.from(excludedDates).filter(value => value >= nextOccurrenceStart)
      );
      await tx.execute(
        'UPDATE events SET startTime = ?, endTime = ?, excludedDates = ?, updatedAt = ? WHERE id = ? AND username = ?',
        [
          nextOccurrenceStart,
          duration > 0 ? nextOccurrenceStart + duration : event.endTime,
          serializeExcludedDates(keptExcludedDates),
          now,
          event.id,
          username
        ]
      );
      return;
    }

    if (effectiveDeletePrevious && !effectiveDeleteCurrent && effectiveDeleteFuture) {
      await tx.execute(
        'UPDATE events SET startTime = ?, endTime = ?, recurrence = NULL, recurrenceEnd = NULL, excludedDates = NULL, updatedAt = ? WHERE id = ? AND username = ?',
        [
          normalizedOccurrenceStartTime,
          duration > 0 ? normalizedOccurrenceStartTime + duration : event.endTime,
          now,
          event.id,
          username
        ]
      );
    }
  });

  return { success: true };
}

async function deleteEvent(username, rawId) {
  const event = await getEventByCandidates(username, rawId, 'id');
  if (!event) {
    throw new Error('EVENT_NOT_FOUND');
  }

  const now = Math.floor(Date.now() / 1000);
  await db.withTransaction(async (tx) => {
    await insertDeletedItem(tx, {
      username,
      itemId: event.id,
      type: 'event',
      deletedAt: now
    });
    await tx.execute('DELETE FROM events WHERE id = ? AND username = ?', [event.id, username]);
  });

  return { success: true };
}

async function getDayCalendarData(username, dateString) {
  const [year, month, day] = dateString.split('-').map(Number);
  const dayDate = new Date(year, month - 1, day);
  const start = Math.floor(dayDate.setHours(0, 0, 0, 0) / 1000);
  const end = Math.floor(dayDate.setHours(23, 59, 59, 999) / 1000);

  const now = new Date();
  const isToday = now.getFullYear() === year && now.getMonth() === month - 1 && now.getDate() === day;

  let todoQuery = 'SELECT * FROM todos WHERE username=? AND dueDate>=? AND dueDate<=?';
  const todoParams = [username, start, end];
  if (isToday) {
    todoQuery = 'SELECT * FROM todos WHERE username=? AND (dueDate IS NULL OR (dueDate>=? AND dueDate<=?))';
  }

  const [todos, rawEvents, notes] = await Promise.all([
    db.queryAll(todoQuery, todoParams),
    db.queryAll(
      'SELECT * FROM events WHERE username=? AND (recurrence IS NOT NULL OR (startTime<=? AND (endTime>=? OR endTime IS NULL)))',
      [username, end, start]
    ),
    db.queryAll('SELECT * FROM notes WHERE username=? AND deleted=0 AND updatedAt >= ?', [username, start])
  ]);

  const dayNotes = notes.filter(note => note.updatedAt >= start && note.updatedAt <= end);
  const expandedEvents = [];

  for (const event of filterCalendarDisplayEvents(username, rawEvents)) {
    if (!event.recurrence) {
      if (event.allDay) {
        const startDate = new Date(event.startTime * 1000);
        const startStr = `${startDate.getUTCFullYear()}-${String(startDate.getUTCMonth() + 1).padStart(2, '0')}-${String(startDate.getUTCDate()).padStart(2, '0')}`;

        const endDate = new Date((event.endTime || event.startTime) * 1000 - 1000);
        const endStr = `${endDate.getUTCFullYear()}-${String(endDate.getUTCMonth() + 1).padStart(2, '0')}-${String(endDate.getUTCDate()).padStart(2, '0')}`;

        if (dateString < startStr || dateString > endStr) {
          continue;
        }
      }

      expandedEvents.push(event);
      continue;
    }

    try {
      expandedEvents.push(...expandRecurringInstancesForRange(event, start, end));
    } catch {
      expandedEvents.push(event);
    }
  }

  return {
    todos: todos.map(todo => mapTodoForClient(username, todo)),
    events: expandedEvents.map(event => mapEventForClient(username, event)),
    notes: dayNotes
  };
}

async function searchCalendarContent(username, rawQuery) {
  const query = rawQuery || '';
  if (!query.trim()) {
    return { todos: [], events: [], notes: [] };
  }

  const pattern = `%${query}%`;
  const [todos, events, notes] = await Promise.all([
    db.queryAll('SELECT * FROM todos WHERE username = ? AND (title LIKE ? OR description LIKE ?)', [username, pattern, pattern]),
    db.queryAll('SELECT * FROM events WHERE username = ? AND (title LIKE ? OR description LIKE ?)', [username, pattern, pattern]),
    db.queryAll('SELECT * FROM notes WHERE username = ? AND deleted = 0 AND (title LIKE ? OR content LIKE ?)', [username, pattern, pattern])
  ]);

  return {
    todos: todos.map(todo => mapTodoForClient(username, todo)),
    events: filterCalendarDisplayEvents(username, events)
      .map(event => mapEventForClient(username, event)),
    notes: notes.map(note => ({ ...note, id: note.id }))
  };
}

async function getEventDetail(username, rawId) {
  const event = await getEventByCandidates(username, rawId);
  if (!event) {
    throw new Error('EVENT_NOT_FOUND');
  }
  return mapEventForClient(username, event);
}

module.exports = {
  createBatchEvents,
  listEvents,
  deleteBatchEvents,
  expandLunarEvents,
  expandRecurringEventsForUser,
  formatUserEvents,
  exportCalendar,
  importCalendar,
  cleanupDuplicateEvents,
  createEvent,
  updateEvent,
  deleteEventScope,
  deleteEvent,
  getDayCalendarData,
  searchCalendarContent,
  getEventDetail
};
