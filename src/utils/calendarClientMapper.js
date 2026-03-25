const { toClientCalendarId } = require('./calendarIds');

function mapTodoForClient(username, todo) {
  if (!todo) return todo;
  return { ...todo, id: toClientCalendarId(username, todo.id) };
}

function mapEventForClient(username, event) {
  if (!event) return event;

  return {
    ...event,
    id: toClientCalendarId(username, event.id),
    _originalId: event._originalId ? toClientCalendarId(username, event._originalId) : event._originalId,
    parentEventId: event.parentEventId ? toClientCalendarId(username, event.parentEventId) : event.parentEventId
  };
}

module.exports = {
  mapTodoForClient,
  mapEventForClient
};
