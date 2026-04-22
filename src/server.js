const { buildApp } = require('./app/setup');
const { startServer: startRuntimeServer, registerProcessHandlers } = require('./runtime/serverRuntime');
const log = require('./utils/logger');

async function startServer(options = {}) {
  const app = options.app || buildApp();
  return startRuntimeServer(app, options);
}

if (require.main === module) {
  let runtime = null;
  registerProcessHandlers(() => runtime);
  startServer().then(startedRuntime => {
    runtime = startedRuntime;
  }).catch(error => {
    log('ERROR', '服务启动失败', { error: error.message, stack: error.stack });
    process.exit(1);
  });
}

module.exports = {
  buildApp,
  startServer
};
