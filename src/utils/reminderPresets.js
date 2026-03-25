const REMINDER_PRESETS = new Set(['none', '15m', 'same_day_9am', 'one_day_9am']);

function getDefaultReminderPreset(allDay) {
  return allDay ? 'same_day_9am' : '15m';
}

function normalizeReminderPreset(reminderPreset, allDay) {
  if (typeof reminderPreset !== 'string' || !REMINDER_PRESETS.has(reminderPreset)) {
    return getDefaultReminderPreset(allDay);
  }

  if (!allDay && (reminderPreset === 'same_day_9am' || reminderPreset === 'one_day_9am')) {
    return '15m';
  }

  return reminderPreset;
}

module.exports = {
  REMINDER_PRESETS,
  getDefaultReminderPreset,
  normalizeReminderPreset
};
