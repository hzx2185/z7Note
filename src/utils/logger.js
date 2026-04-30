const config = require('../config');
const nodeFs = require('fs');
const path = require('path');

const REDACTED_VALUE = '[REDACTED]';
const SENSITIVE_KEY_PATTERN = /(password|pass|secret|token|authorization|cookie|set-cookie|smtp|jwt|session|backupcode|backup_code)/i;
const LOG_PRIORITIES = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40
};

let currentLogDate = null;
let logStream = null;
let currentLogSize = 0;
let stdoutWritable = true;
let stderrWritable = true;
let streamErrorHandlersAttached = false;
let consoleStreamsChecked = false;
const recentLogEntries = new Map();
const MAX_RECENT_LOG_ENTRIES = 500;
let reallyExiting = false;

function getLogRotationConfig() {
  const maxFileSizeMB = Number.isFinite(config.logRotation?.maxFileSizeMB) ? config.logRotation.maxFileSizeMB : 100;
  const maxArchives = Number.isFinite(config.logRotation?.maxArchives) ? config.logRotation.maxArchives : 5;
  return {
    maxFileSizeBytes: Math.max(1, maxFileSizeMB) * 1024 * 1024,
    maxArchives: Math.max(1, maxArchives)
  };
}

function getLoggingConfig() {
  return {
    maxLineBytes: Number.isFinite(config.logging?.maxLineBytes) ? config.logging.maxLineBytes : 16 * 1024,
    maxStringLength: Number.isFinite(config.logging?.maxStringLength) ? config.logging.maxStringLength : 2048,
    maxArrayLength: Number.isFinite(config.logging?.maxArrayLength) ? config.logging.maxArrayLength : 20,
    maxObjectKeys: Number.isFinite(config.logging?.maxObjectKeys) ? config.logging.maxObjectKeys : 50,
    maxDepth: Number.isFinite(config.logging?.maxDepth) ? config.logging.maxDepth : 4,
    dedupeWindowMs: Number.isFinite(config.logging?.dedupeWindowMs) ? config.logging.dedupeWindowMs : 5000
  };
}

function disableConsoleStream(streamName, error) {
  if (streamName === 'stdout') {
    stdoutWritable = false;
  } else {
    stderrWritable = false;
  }

  if (reallyExiting) {
    return;
  }

  const fallback = streamName === 'stdout' ? process.stderr : process.stdout;
  if (!fallback || fallback.destroyed || typeof fallback.write !== 'function') {
    return;
  }

  try {
    fallback.write(`[logger] ${streamName} disabled: ${error.code || error.message}\n`);
  } catch (_) {
  }
}

function attachConsoleStreamErrorHandlers() {
  if (streamErrorHandlersAttached) {
    return;
  }
  streamErrorHandlersAttached = true;

  process.stdout.on('error', (error) => {
    if (error && error.code === 'EPIPE') {
      disableConsoleStream('stdout', error);
    }
  });

  process.stderr.on('error', (error) => {
    if (error && error.code === 'EPIPE') {
      disableConsoleStream('stderr', error);
    }
  });
}

function checkConsoleStreams() {
  if (consoleStreamsChecked) {
    return;
  }
  consoleStreamsChecked = true;

  if (process.stdout && process.stdout.destroyed) {
    stdoutWritable = false;
  }
  if (process.stderr && process.stderr.destroyed) {
    stderrWritable = false;
  }
}

function safeConsoleWrite(streamName, line) {
  checkConsoleStreams();

  const stream = streamName === 'stdout' ? process.stdout : process.stderr;
  const canWrite = streamName === 'stdout' ? stdoutWritable : stderrWritable;
  if (!canWrite || !stream || stream.destroyed) {
    return;
  }

  try {
    stream.write(`${line}\n`);
  } catch (error) {
    if (error && error.code === 'EPIPE') {
      disableConsoleStream(streamName, error);
      return;
    }
    throw error;
  }
}

function writeToStdout(line) {
  safeConsoleWrite('stdout', line);
}

function writeToStderr(line) {
  safeConsoleWrite('stderr', line);
}

function getLogDate() {
  return new Date().toISOString().split('T')[0];
}

function getLogFilePath(logDate) {
  return path.join(config.paths.logs, `app-${logDate}.log`);
}

function getArchiveLogPrefix(logDate) {
  return `app-${logDate}.`;
}

function getArchiveLogPath(logDate) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(config.paths.logs, `${getArchiveLogPrefix(logDate)}${stamp}.log`);
}

function listArchiveLogPaths(logDate) {
  const prefix = getArchiveLogPrefix(logDate);
  return nodeFs.readdirSync(config.paths.logs)
    .filter(name => name.startsWith(prefix) && name.endsWith('.log'))
    .sort()
    .map(name => path.join(config.paths.logs, name));
}

function pruneArchiveLogs(logDate) {
  const { maxArchives } = getLogRotationConfig();
  const archivePaths = listArchiveLogPaths(logDate);
  const filesToDelete = archivePaths.slice(0, Math.max(0, archivePaths.length - maxArchives));

  for (const archivePath of filesToDelete) {
    try {
      nodeFs.unlinkSync(archivePath);
    } catch (error) {
      writeToStderr(`删除旧日志归档失败: ${error.message}`);
    }
  }
}

function closeLogStream() {
  if (!logStream) {
    return;
  }

  logStream.end();
  logStream = null;
}

function rotateLogStream(logDate) {
  const activeLogPath = getLogFilePath(logDate);
  const archiveLogPath = getArchiveLogPath(logDate);

  closeLogStream();
  nodeFs.renameSync(activeLogPath, archiveLogPath);
  currentLogSize = 0;
  pruneArchiveLogs(logDate);
}

function ensureLogStream() {
  attachConsoleStreamErrorHandlers();
  const logDate = getLogDate();
  if (logStream && currentLogDate === logDate) {
    return logStream;
  }

  closeLogStream();

  currentLogDate = logDate;
  const logFilePath = getLogFilePath(logDate);
  try {
    currentLogSize = nodeFs.existsSync(logFilePath) ? nodeFs.statSync(logFilePath).size : 0;
  } catch (_) {
    currentLogSize = 0;
  }
  logStream = nodeFs.createWriteStream(logFilePath, { flags: 'a' });
  logStream.on('error', (err) => {
    writeToStderr(`写入日志失败: ${err.message}`);
  });

  return logStream;
}

function truncateString(value, maxLength) {
  if (typeof value !== 'string') {
    return value;
  }

  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}...[truncated ${value.length - maxLength} chars]`;
}

function normalizeForLogging(value, { key = '', depth = 0, seen = new WeakSet() } = {}) {
  const {
    maxStringLength,
    maxArrayLength,
    maxObjectKeys,
    maxDepth
  } = getLoggingConfig();

  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return REDACTED_VALUE;
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    return truncateString(value, maxStringLength);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'function') {
    return `[Function ${value.name || 'anonymous'}]`;
  }

  if (Buffer.isBuffer(value)) {
    return `[Buffer ${value.length} bytes]`;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: truncateString(value.message, maxStringLength),
      stack: truncateString(value.stack || '', maxStringLength)
    };
  }

  if (depth >= maxDepth) {
    const typeName = value && value.constructor && value.constructor.name ? value.constructor.name : 'Object';
    return `[${typeName} depth limit]`;
  }

  if (typeof value !== 'object') {
    return truncateString(String(value), maxStringLength);
  }

  if (seen.has(value)) {
    return '[Circular]';
  }

  seen.add(value);

  if (Array.isArray(value)) {
    const normalizedItems = value
      .slice(0, maxArrayLength)
      .map(item => normalizeForLogging(item, { key, depth: depth + 1, seen }));

    if (value.length > maxArrayLength) {
      normalizedItems.push(`[${value.length - maxArrayLength} more items]`);
    }

    seen.delete(value);
    return normalizedItems;
  }

  if (value instanceof Set) {
    const normalizedSet = normalizeForLogging(Array.from(value), { key, depth: depth + 1, seen });
    seen.delete(value);
    return normalizedSet;
  }

  if (value instanceof Map) {
    const normalizedMap = {};
    let index = 0;
    for (const [mapKey, mapValue] of value.entries()) {
      if (index >= maxObjectKeys) {
        normalizedMap.__truncatedEntries__ = value.size - maxObjectKeys;
        break;
      }
      normalizedMap[String(mapKey)] = normalizeForLogging(mapValue, {
        key: String(mapKey),
        depth: depth + 1,
        seen
      });
      index++;
    }
    seen.delete(value);
    return normalizedMap;
  }

  const entries = Object.entries(value);
  const normalizedObject = {};
  for (const [entryIndex, [entryKey, entryValue]] of entries.entries()) {
    if (entryIndex >= maxObjectKeys) {
      normalizedObject.__truncatedKeys__ = entries.length - maxObjectKeys;
      break;
    }

    normalizedObject[entryKey] = normalizeForLogging(entryValue, {
      key: entryKey,
      depth: depth + 1,
      seen
    });
  }

  seen.delete(value);
  return normalizedObject;
}

function sanitizeData(data) {
  return normalizeForLogging(data);
}

function normalizeLogPayload(data) {
  const sanitized = sanitizeData(data);
  if (sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)) {
    return sanitized;
  }
  if (sanitized === undefined) {
    return {};
  }
  return { data: sanitized };
}

function pruneRecentLogEntries(now = Date.now()) {
  const { dedupeWindowMs } = getLoggingConfig();
  const expiryWindowMs = Math.max(dedupeWindowMs * 3, 15000);

  for (const [signature, state] of recentLogEntries.entries()) {
    if (now - state.lastSeenAt > expiryWindowMs) {
      recentLogEntries.delete(signature);
    }
  }

  if (recentLogEntries.size <= MAX_RECENT_LOG_ENTRIES) {
    return;
  }

  const entries = Array.from(recentLogEntries.entries())
    .sort((a, b) => a[1].lastSeenAt - b[1].lastSeenAt);

  while (entries.length > MAX_RECENT_LOG_ENTRIES) {
    const [signature] = entries.shift();
    recentLogEntries.delete(signature);
  }
}

function getDuplicateLogDecision(level, message, data) {
  const { dedupeWindowMs } = getLoggingConfig();
  if (dedupeWindowMs <= 0) {
    return { shouldSkip: false, suppressedCount: 0 };
  }

  const now = Date.now();
  const signature = `${level}|${message}|${JSON.stringify(data)}`;
  const recentState = recentLogEntries.get(signature);

  if (recentState && now - recentState.lastEmittedAt < dedupeWindowMs) {
    recentState.suppressedCount += 1;
    recentState.lastSeenAt = now;
    recentLogEntries.set(signature, recentState);
    pruneRecentLogEntries(now);
    return { shouldSkip: true, suppressedCount: 0 };
  }

  const suppressedCount = recentState ? recentState.suppressedCount : 0;
  recentLogEntries.set(signature, {
    lastEmittedAt: now,
    lastSeenAt: now,
    suppressedCount: 0
  });
  pruneRecentLogEntries(now);

  return { shouldSkip: false, suppressedCount };
}

function serializeLogEntry(logEntry) {
  const { maxLineBytes, maxStringLength } = getLoggingConfig();
  let serialized = JSON.stringify(logEntry);
  const originalSizeBytes = Buffer.byteLength(serialized);

  if (originalSizeBytes <= maxLineBytes) {
    return serialized;
  }

  serialized = JSON.stringify({
    timestamp: logEntry.timestamp,
    level: logEntry.level,
    message: truncateString(logEntry.message, Math.min(maxStringLength, 512)),
    truncated: true,
    originalSizeBytes,
    keys: Object.keys(logEntry).filter(key => !['timestamp', 'level', 'message'].includes(key)).slice(0, 10)
  });

  if (Buffer.byteLength(serialized) <= maxLineBytes) {
    return serialized;
  }

  return JSON.stringify({
    timestamp: logEntry.timestamp,
    level: logEntry.level,
    message: truncateString(logEntry.message, 128),
    truncated: true,
    originalSizeBytes
  });
}

function writeLogLine(line) {
  const serializedLine = `${line}\n`;
  const lineSize = Buffer.byteLength(serializedLine);

  try {
    const logDate = getLogDate();
    const { maxFileSizeBytes } = getLogRotationConfig();

    if (currentLogDate === logDate && currentLogSize > 0 && currentLogSize + lineSize > maxFileSizeBytes) {
      rotateLogStream(logDate);
    }

    ensureLogStream().write(serializedLine);
    currentLogSize += lineSize;
  } catch (error) {
    writeToStderr(`写入日志失败: ${error.message}`);
  }
}

function shouldLog(level) {
  const configuredLevel = config.logging?.level || 'INFO';
  const currentPriority = LOG_PRIORITIES[level] ?? LOG_PRIORITIES.INFO;
  const minimumPriority = LOG_PRIORITIES[configuredLevel] ?? LOG_PRIORITIES.INFO;
  return currentPriority >= minimumPriority;
}

function log(level, message, data = {}) {
  if (!shouldLog(level)) {
    return;
  }

  if (reallyExiting) {
    return;
  }

  const timestamp = new Date().toISOString();
  const sanitizedData = normalizeLogPayload(data);
  const duplicateDecision = getDuplicateLogDecision(level, message, sanitizedData);
  if (duplicateDecision.shouldSkip) {
    return;
  }

  const logData = duplicateDecision.suppressedCount > 0
    ? { ...sanitizedData, suppressedDuplicates: duplicateDecision.suppressedCount }
    : sanitizedData;
  const logEntry = {
    timestamp,
    level,
    message,
    ...logData
  };
  const serialized = serializeLogEntry(logEntry);

  if (level === 'ERROR') {
    writeToStderr(serialized);
  } else {
    writeToStdout(serialized);
  }
  writeLogLine(serialized);
}

log.protocol = function protocolLog(message, data = {}) {
  if (!config.logging?.protocolDebugLogs) {
    return;
  }

  log('INFO', message, data);
};

log.setReallyExiting = function() {
  reallyExiting = true;
};

module.exports = log;
