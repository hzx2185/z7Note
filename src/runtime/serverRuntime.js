const nodeCron = require('node-cron');

const config = require('../config');
const { connect, getConnection, close } = require('../db/sqlite-connection');
const { setupCron, getBackupConfig } = require('../services/backup');
const { initCacheDir, setupAutoUpdate } = require('../services/cdnProxy');
const { initWebSocketServer } = require('../routes/ws');
const { initDefaultConfig } = require('../services/systemConfig');
const { cleanupExpiredSessions, initChunksDir } = require('../services/chunkUpload');
const { cleanupAllLimiters } = require('../utils/dynamicRateLimiter');
const { setupUserBackupCron, getUserBackupConfig } = require('../services/userExport');
const { checkAndSendPendingReminders } = require('../services/reminderService');
const { sendMembershipExpiryNotices } = require('../services/memberNoticeService');
const { syncSubscription } = require('../routes/calendarSubscriptions');
const log = require('../utils/logger');

function stopScheduledTasks(tasks) {
  for (const task of tasks) {
    if (task && typeof task.stop === 'function') {
      task.stop();
    }
    if (task && typeof task.destroy === 'function') {
      task.destroy();
    }
  }
}

function createTaskRunner(taskName) {
  let running = false;
  let overlapWarned = false;

  return async (handler) => {
    if (running) {
      if (!overlapWarned) {
        log('WARN', '定时任务仍在运行，跳过重复触发', { task: taskName });
        overlapWarned = true;
      }
      return { skipped: true, reason: 'running' };
    }

    running = true;
    overlapWarned = false;

    try {
      return await handler();
    } finally {
      running = false;
    }
  };
}

function createReminderTask() {
  const runReminderTask = createTaskRunner('reminders');
  const task = nodeCron.schedule('* * * * *', async () => {
    await runReminderTask(async () => {
      try {
        const summary = await checkAndSendPendingReminders();
        if (!summary || summary.skipped) {
          return summary;
        }

        if (summary.failedCount > 0) {
          log('WARN', '提醒检查完成，存在发送失败', {
            task: 'reminders',
            usersChecked: summary.usersChecked,
            quietUsers: summary.quietUsers,
            eventCandidates: summary.eventCandidates,
            todoCandidates: summary.todoCandidates,
            triggeredCount: summary.triggeredCount,
            sentCount: summary.sentCount,
            failedCount: summary.failedCount,
            failureSamples: summary.failureSamples.length > 0 ? summary.failureSamples : undefined
          });
          return summary;
        }

        if (summary.sentCount > 0) {
          log('INFO', '提醒检查完成', {
            task: 'reminders',
            usersChecked: summary.usersChecked,
            quietUsers: summary.quietUsers,
            triggeredCount: summary.triggeredCount,
            sentCount: summary.sentCount
          });
        }

        return summary;
      } catch (error) {
        log('ERROR', '提醒检查失败', { task: 'reminders', error: error.message, stack: error.stack });
        return { error: error.message };
      }
    });
  });
  log('INFO', '提醒服务已启动', { task: 'reminders', schedule: '* * * * *' });
  return task;
}

function createUploadCleanupTask() {
  const runCleanupTask = createTaskRunner('cleanup_upload_sessions');
  return nodeCron.schedule('0 * * * *', async () => {
    await runCleanupTask(async () => {
      try {
        const count = await cleanupExpiredSessions();
        if (count > 0) {
          log('INFO', '清理过期上传会话完成', { task: 'cleanup_upload_sessions', count });
        }
        return { count };
      } catch (error) {
        log('ERROR', '清理过期上传会话失败', { task: 'cleanup_upload_sessions', error: error.message, stack: error.stack });
        return { error: error.message };
      }
    });
  });
}

function createCalendarSyncTask() {
  const runCalendarSyncTask = createTaskRunner('calendar_subscription_sync');
  const task = nodeCron.schedule('0 */12 * * *', async () => {
    await runCalendarSyncTask(async () => {
      try {
        const connection = getConnection();
        const subscriptions = await connection.all('SELECT id, username, name FROM calendar_subscriptions WHERE enabled = 1');
        const summary = {
          processedCount: subscriptions.length,
          successCount: 0,
          failCount: 0,
          importedCount: 0,
          failureSamples: []
        };

        for (const subscription of subscriptions) {
          try {
            const count = await syncSubscription(subscription.id, subscription.username, { logStart: false });
            summary.successCount += 1;
            summary.importedCount += count;
          } catch (error) {
            summary.failCount += 1;
            if (summary.failureSamples.length < 5) {
              summary.failureSamples.push({
                subscriptionId: subscription.id,
                subscriptionName: subscription.name,
                username: subscription.username,
                error: error.message
              });
            }
          }
        }

        if (summary.processedCount === 0) {
          return summary;
        }

        const logLevel = summary.failCount > 0 ? 'WARN' : 'INFO';
        log(logLevel, '自动同步日历订阅完成', {
          task: 'calendar_subscription_sync',
          processedCount: summary.processedCount,
          successCount: summary.successCount,
          failCount: summary.failCount,
          importedCount: summary.importedCount,
          failureSamples: summary.failureSamples.length > 0 ? summary.failureSamples : undefined
        });

        return summary;
      } catch (error) {
        log('ERROR', '自动同步订阅全局错误', {
          task: 'calendar_subscription_sync',
          error: error.message,
          stack: error.stack
        });
        return { error: error.message };
      }
    });
  });
  log('INFO', '日历订阅同步服务已启动', { task: 'calendar_subscription_sync', schedule: '0 */12 * * *' });
  return task;
}

function createMembershipNoticeTask() {
  const runMembershipTask = createTaskRunner('membership_expiry_notice');
  const task = nodeCron.schedule('0 9 * * *', async () => {
    await runMembershipTask(async () => {
      try {
        const result = await sendMembershipExpiryNotices();
        if (result.expiringCount > 0 || result.expiredCount > 0) {
          log('INFO', '会员到期提醒任务执行完成', {
            task: 'membership_expiry_notice',
            expiringCount: result.expiringCount,
            expiredCount: result.expiredCount
          });
        }
        return result;
      } catch (error) {
        log('ERROR', '会员到期提醒任务失败', {
          task: 'membership_expiry_notice',
          error: error.message,
          stack: error.stack
        });
        return { error: error.message };
      }
    });
  });
  log('INFO', '会员到期提醒任务已启动', { task: 'membership_expiry_notice', schedule: '0 9 * * *' });
  return task;
}

async function initializeRuntime({ enableBackgroundJobs = true } = {}) {
  await connect();
  await initDefaultConfig();
  await initChunksDir();
  await initCacheDir();

  if (!enableBackgroundJobs) {
    return [];
  }

  const backupConfig = await getBackupConfig();
  if (backupConfig) {
    setupCron(backupConfig);
  }

  const connection = getConnection();
  const users = await connection.all('SELECT username FROM users');
  for (const user of users) {
    const userBackupConfig = await getUserBackupConfig(user.username);
    if (userBackupConfig && userBackupConfig.enabled) {
      setupUserBackupCron(user.username, userBackupConfig);
    }
  }

  setupAutoUpdate();

  return [
    createReminderTask(),
    createUploadCleanupTask(),
    createCalendarSyncTask(),
    createMembershipNoticeTask()
  ];
}

async function shutdownRuntime({ server, scheduledTasks, signal = 'manual', exitCode } = {}) {
  log('INFO', '收到关闭信号，准备安全关闭', { signal });

  if (server) {
    await new Promise(resolve => server.close(() => {
      log('INFO', 'HTTP 服务已停止');
      resolve();
    }));
  }

  stopScheduledTasks(scheduledTasks || []);
  cleanupAllLimiters();

  try {
    await close();
  } catch (error) {
    log('ERROR', '关闭数据库失败', { phase: 'shutdown', error: error.message, stack: error.stack });
  }

  if (typeof exitCode === 'number') {
    setTimeout(() => process.exit(exitCode), 500);
  }
}

async function startServer(app, options = {}) {
  const host = options.host || config.host;
  const port = options.port ?? config.port;
  const enableBackgroundJobs = options.enableBackgroundJobs !== false;
  const enableWebSocket = options.enableWebSocket !== false;

  let server;
  let scheduledTasks = [];
  let shuttingDown = false;

  try {
    scheduledTasks = await initializeRuntime({ enableBackgroundJobs });

    await new Promise((resolve, reject) => {
      server = app.listen(port, host, error => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
      server.once('error', reject);
    });

    server.removeAllListeners('error');

    if (enableWebSocket) {
      initWebSocketServer(server);
    }

    const address = server.address();
    log('INFO', '服务启动完成', {
      host,
      port: address && typeof address === 'object' ? address.port : port,
      accessUrl: `http://${host === '0.0.0.0' ? 'localhost' : host}:${address && typeof address === 'object' ? address.port : port}`,
      defaultNoteLimit: config.defaultNoteLimit,
      defaultFileLimit: config.defaultFileLimit,
      cdnCacheDir: `${config.paths.data}/cdn-cache`,
      maxFileSize: config.maxFileSize
    });

    async function shutdown(signal = 'manual', exitCode) {
      if (shuttingDown) {
        return;
      }
      shuttingDown = true;
      await shutdownRuntime({ server, scheduledTasks, signal, exitCode });
    }

    return { app, server, shutdown };
  } catch (error) {
    stopScheduledTasks(scheduledTasks);
    cleanupAllLimiters();
    try {
      await close();
    } catch (closeError) {
      log('ERROR', '启动失败后的数据库关闭异常', { error: closeError.message, stack: closeError.stack });
    }
    throw error;
  }
}

function registerProcessHandlers(runtimeGetter) {
  process.on('uncaughtException', error => {
    if (error && error.code === 'EPIPE') {
      log.setReallyExiting();
      process.reallyExit(1);
    }

    log('ERROR', '未捕获异常', { phase: 'uncaughtException', error: error.message, stack: error.stack });
    const runtime = runtimeGetter();
    if (runtime) {
      runtime.shutdown('uncaughtException', 1);
    } else {
      process.exit(1);
    }
  });

  process.on('unhandledRejection', reason => {
    const errorMessage = reason instanceof Error ? reason.message : String(reason);
    const errorStack = reason instanceof Error ? reason.stack : undefined;
    log('ERROR', '未处理的 Promise 拒绝', { phase: 'unhandledRejection', error: errorMessage, stack: errorStack });
    const runtime = runtimeGetter();
    if (runtime) {
      runtime.shutdown('unhandledRejection', 1);
    } else {
      process.exit(1);
    }
  });

  process.on('SIGTERM', () => {
    const runtime = runtimeGetter();
    if (runtime) {
      runtime.shutdown('SIGTERM', 0);
    }
  });

  process.on('SIGINT', () => {
    const runtime = runtimeGetter();
    if (runtime) {
      runtime.shutdown('SIGINT', 0);
    }
  });
}

module.exports = {
  startServer,
  registerProcessHandlers
};
