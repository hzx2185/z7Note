const config = require('../config');
const nodeFs = require('fs');
const path = require('path');

function log(level, message, data = {}) {
  const timestamp = new Date().toISOString();
  const logEntry = JSON.stringify({ timestamp, level, message, ...data });
  console.log(`[${timestamp}] ${level}: ${message}`, data);

  // 写入日志文件
  const logFile = path.join(config.paths.logs, `app-${new Date().toISOString().split('T')[0]}.log`);
  nodeFs.appendFile(logFile, logEntry + '\n', (err) => {
    if (err) console.error('写入日志失败:', err);
  });
}

module.exports = log;
