const nodemailer = require('nodemailer');
const config = require('../config');

const transporter = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: config.smtp.secure,
  auth: { user: config.smtp.user, pass: config.smtp.pass }
});

async function sendMail(options) {
  try {
    const result = await transporter.sendMail({
      from: `"z7Note" <${config.smtp.user}>`,
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
