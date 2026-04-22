const config = require('../config');
const nodeFs = require('fs');
const path = require('path');

const REDACTED_VALUE = '[REDACTED]';
const SENSITIVE_KEY_PATTERN = /(password|pass|secret|token|authorization|cookie|set-cookie|smtp|jwt|session|backupcode|backup_code)/i;

let currentLogDate = null;
let logStream = null;

function writeToStdout(line) {
  process.stdout.write(`${line}\n`);
}

function writeToStderr(line) {
  process.stderr.write(`${line}\n`);
}

function getLogDate() {
  return new Date().toISOString().split('T')[0];
}

function getLogFilePath(logDate) {
  return path.join(config.paths.logs, `app-${logDate}.log`);
}

function ensureLogStream() {
  const logDate = getLogDate();
  if (logStream && currentLogDate === logDate) {
    return logStream;
  }

  if (logStream) {
    logStream.end();
  }

  currentLogDate = logDate;
  logStream = nodeFs.createWriteStream(getLogFilePath(logDate), { flags: 'a' });
  logStream.on('error', (err) => {
    writeToStderr(`写入日志失败: ${err.message}`);
  });

  return logStream;
}

function redactValue(key, value) {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return REDACTED_VALUE;
  }

  if (Array.isArray(value)) {
    return value.map(item => redactValue(key, item));
  }

  if (value && typeof value === 'object') {
    return sanitizeData(value);
  }

  return value;
}

function sanitizeData(data) {
  if (!data || typeof data !== 'object') {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map(item => sanitizeData(item));
  }

  const sanitized = {};
  for (const [key, value] of Object.entries(data)) {
    sanitized[key] = redactValue(key, value);
  }
  return sanitized;
}

function writeLogLine(line) {
  try {
    ensureLogStream().write(`${line}\n`);
  } catch (error) {
    writeToStderr(`写入日志失败: ${error.message}`);
  }
}

function log(level, message, data = {}) {
  const timestamp = new Date().toISOString();
  const sanitizedData = sanitizeData(data);
  const logEntry = {
    timestamp,
    level,
    message,
    ...sanitizedData
  };
  const serialized = JSON.stringify(logEntry);

  if (level === 'ERROR') {
    writeToStderr(serialized);
  } else {
    writeToStdout(serialized);
  }
  writeLogLine(serialized);
}

module.exports = log;
