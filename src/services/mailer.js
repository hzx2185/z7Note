const nodemailer = require('nodemailer');
const { getSmtpConfig } = require('./systemConfig');

// 缓存 transporter 实例
let cachedTransporter = null;
let lastConfig = null;

/**
 * 获取或创建 transporter
 */
async function getTransporter() {
  const config = await getSmtpConfig();
  
  // 如果配置没有变化，返回缓存的 transporter
  if (cachedTransporter && lastConfig && 
      lastConfig.host === config.host &&
      lastConfig.port === config.port &&
      lastConfig.user === config.user &&
      lastConfig.pass === config.pass) {
    return cachedTransporter;
  }

  // 创建新的 transporter，添加超时配置
  cachedTransporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.user ? { user: config.user, pass: config.pass } : undefined,
    connectionTimeout: 10000, // 10秒连接超时
    socketTimeout: 10000, // 10秒socket超时
    greetingTimeout: 10000, // 10秒问候超时
    logger: false, // 禁用日志
    debug: false // 禁用调试
  });

  lastConfig = config;
  return cachedTransporter;
}

async function sendMail(options) {
  try {
    const config = await getSmtpConfig();
    
    // 检查配置是否完整
    if (!config.host || !config.user) {
      throw new Error('SMTP 配置不完整，请先在管理后台配置 SMTP 服务器信息');
    }
    
    // 每次都创建新的 transporter，避免缓存问题
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.user ? { user: config.user, pass: config.pass } : undefined,
      connectionTimeout: 10000,
      socketTimeout: 10000,
      greetingTimeout: 10000,
      logger: false,
      debug: false
    });
    
    // 验证连接
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('SMTP 连接超时，请检查网络或防火墙设置'));
      }, 10000);
      
      transporter.verify((error, success) => {
        clearTimeout(timeout);
        if (error) {
          console.error('SMTP 连接验证失败:', error.message);
          reject(new Error('SMTP 连接失败: ' + error.message));
        } else {
          console.log('SMTP 连接验证成功');
          resolve(success);
        }
      });
    });
    
    const result = await transporter.sendMail({
      from: config.user ? `"z7Note" <${config.user}>` : options.from,
      ...options
    });
    return result;
  } catch (e) {
    console.error('邮件发送失败:', e.message);
    console.error('错误详情:', e);
    throw e;
  }
}

module.exports = { sendMail };
