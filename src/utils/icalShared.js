const TimeHelper = require('./timeHelper');

function getReminderTrigger(event) {
  const preset = event.reminderPreset || (event.allDay ? 'same_day_9am' : '15m');
  const timeZone = event.timezone || TimeHelper.getAppTimeZone();

  switch (preset) {
    case '15m':
      if (event.allDay) {
        const reminderTs = TimeHelper.getReminderPresetTs(event.startTime, preset, timeZone, { allDay: true });
        return reminderTs ? `;VALUE=DATE-TIME:${TimeHelper.toIcalUTC(reminderTs)}` : null;
      }
      return ':-PT15M';
    case 'same_day_9am':
      if (event.allDay) {
        const reminderTs = TimeHelper.getReminderPresetTs(event.startTime, preset, timeZone, { allDay: true });
        return reminderTs ? `;VALUE=DATE-TIME:${TimeHelper.toIcalUTC(reminderTs)}` : null;
      }
      return ':-PT15M';
    case 'one_day_9am':
      if (event.allDay) {
        const reminderTs = TimeHelper.getReminderPresetTs(event.startTime, preset, timeZone, { allDay: true });
        return reminderTs ? `;VALUE=DATE-TIME:${TimeHelper.toIcalUTC(reminderTs)}` : null;
      }
      return ':-P1D';
    default:
      return null;
  }
}

function parseAbsoluteTrigger(trigger) {
  const match = String(trigger || '').trim().toUpperCase().match(/(?:;VALUE=DATE-TIME:)?(\d{8}T\d{6}Z)$/);
  if (!match) return null;

  const value = match[1];
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const hour = Number(value.slice(9, 11));
  const minute = Number(value.slice(11, 13));
  const second = Number(value.slice(13, 15));
  return Math.floor(Date.UTC(year, month - 1, day, hour, minute, second) / 1000);
}

function inferReminderPreset(item, alarmsOrTrigger) {
  let trigger = '';

  if (Array.isArray(alarmsOrTrigger)) {
    if (alarmsOrTrigger.length === 0) {
      return 'none';
    }
    const displayAlarm = alarmsOrTrigger.find(alarm => alarm && alarm.action !== 'EMAIL') || alarmsOrTrigger[0];
    trigger = String(displayAlarm?.trigger || '').trim().toUpperCase();
  } else {
    trigger = String(alarmsOrTrigger || '').trim().toUpperCase();
  }

  if (trigger === '-PT15M') {
    return '15m';
  }

  if (item.allDay) {
    const timeZone = item.timezone || TimeHelper.getAppTimeZone();
    const triggerTs = parseAbsoluteTrigger(trigger);
    const sameDayTs = TimeHelper.getReminderPresetTs(item.startTime, 'same_day_9am', timeZone, { allDay: true });
    const oneDayTs = TimeHelper.getReminderPresetTs(item.startTime, 'one_day_9am', timeZone, { allDay: true });
    const fifteenMinuteTs = TimeHelper.getReminderPresetTs(item.startTime, '15m', timeZone, { allDay: true });

    if (triggerTs && fifteenMinuteTs && Math.abs(triggerTs - fifteenMinuteTs) <= 60) return '15m';
    if (triggerTs && sameDayTs && Math.abs(triggerTs - sameDayTs) <= 60) return 'same_day_9am';
    if (triggerTs && oneDayTs && Math.abs(triggerTs - oneDayTs) <= 60) return 'one_day_9am';
  }

  return item.allDay ? 'same_day_9am' : '15m';
}

function getTimezoneOffset(timezone) {
  const timezoneMap = {
    'Asia/Shanghai': 8,
    'Asia/Chongqing': 8,
    'Asia/Hong_Kong': 8,
    'Asia/Taipei': 8,
    'Asia/Singapore': 8,
    'Asia/Tokyo': 9,
    'Asia/Seoul': 9,
    'Asia/Dubai': 4,
    'Asia/Kolkata': 5.5,
    'Europe/London': 0,
    'Europe/Paris': 1,
    'Europe/Berlin': 1,
    'Europe/Moscow': 3,
    'America/New_York': -5,
    'America/Chicago': -6,
    'America/Denver': -7,
    'America/Los_Angeles': -8,
    'America/Sao_Paulo': -3,
    'Australia/Sydney': 10,
    'Pacific/Auckland': 12
  };

  return timezoneMap[timezone] !== undefined ? timezoneMap[timezone] : null;
}

function escapeICS(text) {
  if (!text) return '';
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function unescapeICS(text) {
  if (!text) return '';
  return text
    .replace(/\\n/g, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

function formatICSDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function formatICSDateTime(date, options = {}) {
  const { allDay = false, utc = false, timezone = 'Asia/Shanghai' } = options;

  if (allDay) {
    return formatICSDate(date);
  }

  if (utc) {
    const utcYear = date.getUTCFullYear();
    const utcMonth = String(date.getUTCMonth() + 1).padStart(2, '0');
    const utcDay = String(date.getUTCDate()).padStart(2, '0');
    const utcHours = String(date.getUTCHours()).padStart(2, '0');
    const utcMinutes = String(date.getUTCMinutes()).padStart(2, '0');
    const utcSeconds = String(date.getUTCSeconds()).padStart(2, '0');
    return `${utcYear}${utcMonth}${utcDay}T${utcHours}${utcMinutes}${utcSeconds}Z`;
  }

  const offset = getTimezoneOffset(timezone);
  if (offset !== null) {
    const localTime = new Date(date.getTime() + offset * 60 * 60 * 1000);
    const year = localTime.getUTCFullYear();
    const month = String(localTime.getUTCMonth() + 1).padStart(2, '0');
    const day = String(localTime.getUTCDate()).padStart(2, '0');
    const hours = String(localTime.getUTCHours()).padStart(2, '0');
    const minutes = String(localTime.getUTCMinutes()).padStart(2, '0');
    const seconds = String(localTime.getUTCSeconds()).padStart(2, '0');
    return `${year}${month}${day}T${hours}${minutes}${seconds}`;
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}T${hours}${minutes}${seconds}`;
}

function parseICSDate(icsDate) {
  let value = icsDate;
  let isAllDay = false;
  let isUTC = false;
  let tzId = '';

  const colonIndex = String(icsDate).indexOf(':');
  if (colonIndex >= 0) {
    const keyPart = String(icsDate).slice(0, colonIndex);
    value = String(icsDate).slice(colonIndex + 1);

    if (/VALUE=DATE/i.test(keyPart)) {
      isAllDay = true;
    }

    const tzidMatch = keyPart.match(/TZID=([^;:]+)/i);
    if (tzidMatch) {
      tzId = tzidMatch[1];
    }
  }

  if (value.endsWith('Z')) {
    isUTC = true;
    value = value.slice(0, -1);
  }

  const year = parseInt(value.substring(0, 4), 10);
  const month = parseInt(value.substring(4, 6), 10) - 1;
  const day = parseInt(value.substring(6, 8), 10);

  if (isAllDay) {
    return Math.floor(Date.UTC(year, month, day) / 1000);
  }

  const hours = parseInt(value.substring(9, 11), 10);
  const minutes = parseInt(value.substring(11, 13), 10);
  const seconds = parseInt(value.substring(13, 15), 10);

  let date;
  if (isUTC) {
    date = new Date(Date.UTC(year, month, day, hours, minutes, seconds));
  } else if (tzId) {
    const offset = getTimezoneOffset(tzId);
    if (offset !== null) {
      const localTimestamp = Date.UTC(year, month, day, hours, minutes, seconds);
      date = new Date(localTimestamp - offset * 60 * 60 * 1000);
    } else {
      date = new Date(year, month, day, hours, minutes, seconds);
    }
  } else {
    date = new Date(Date.UTC(year, month, day, hours, minutes, seconds));
  }

  return Math.floor(date.getTime() / 1000);
}

function formatLocalTime(ts, timezone = 'Asia/Shanghai') {
  if (!ts) return '';
  const date = new Date(ts * 1000);

  try {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });

    const parts = formatter.formatToParts(date);
    const getPart = type => parts.find(part => part.type === type).value;

    const year = getPart('year');
    const month = getPart('month');
    const day = getPart('day');
    let hour = getPart('hour');
    if (hour === '24') hour = '00';
    const minute = getPart('minute');
    const second = getPart('second');

    return `${year}${month}${day}T${hour}${minute}${second}`;
  } catch {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    const second = String(date.getSeconds()).padStart(2, '0');
    return `${year}${month}${day}T${hour}${minute}${second}`;
  }
}

function foldIcsLines(content) {
  return content.split(/\r?\n/).map(line => {
    if (line.length <= 75) return line;
    let result = '';
    let currentLine = line;
    while (currentLine.length > 75) {
      result += currentLine.substring(0, 75) + '\r\n ';
      currentLine = currentLine.substring(75);
    }
    result += currentLine;
    return result;
  }).join('\r\n');
}

function mapPriorityToICal(priority) {
  if (priority <= 1) return 1;
  if (priority <= 3) return 5;
  return 9;
}

function mapPriorityFromICal(priority) {
  const parsed = parseInt(priority, 10);
  if (parsed >= 1 && parsed <= 4) return 1;
  if (parsed === 5) return 3;
  if (parsed >= 6 && parsed <= 9) return 5;
  return 5;
}

module.exports = {
  getReminderTrigger,
  parseAbsoluteTrigger,
  inferReminderPreset,
  getTimezoneOffset,
  escapeICS,
  unescapeICS,
  formatICSDate,
  formatICSDateTime,
  parseICSDate,
  formatLocalTime,
  foldIcsLines,
  mapPriorityToICal,
  mapPriorityFromICal
};
