/**
 * 数据库迁移 - 添加 SMTP 配置到系统配置表
 */
module.exports = {
  version: 20,
  description: '将 SMTP 配置从环境变量迁移到数据库系统配置表',
  async migrate(db) {
    console.log('开始迁移: 添加 SMTP 配置到系统配置表...');

    try {
      const now = Math.floor(Date.now() / 1000);

      // 定义 SMTP 配置项
      const smtpConfigs = [
        {
          key: 'smtp_host',
          value: process.env.SMTP_HOST || 'localhost',
          description: 'SMTP 服务器地址'
        },
        {
          key: 'smtp_port',
          value: process.env.SMTP_PORT || '587',
          description: 'SMTP 服务器端口'
        },
        {
          key: 'smtp_secure',
          value: process.env.SMTP_SECURE || 'false',
          description: '是否使用 SSL/TLS (true/false)'
        },
        {
          key: 'smtp_user',
          value: process.env.SMTP_USER || '',
          description: 'SMTP 用户名（邮箱地址）'
        },
        {
          key: 'smtp_pass',
          value: process.env.SMTP_PASS || '',
          description: 'SMTP 密码或授权码'
        }
      ];

      // 插入配置项
      for (const config of smtpConfigs) {
        // 检查是否已存在
        const existing = await db.get('SELECT key FROM system_config WHERE key = ?', [config.key]);

        if (!existing) {
          await db.run(
            'INSERT INTO system_config (key, value, description, updatedAt) VALUES (?, ?, ?, ?)',
            [config.key, config.value, config.description, now]
          );
          console.log(`已添加配置项: ${config.key}`);
        } else {
          console.log(`配置项已存在，跳过: ${config.key}`);
        }
      }

      console.log('迁移完成: SMTP 配置已添加到系统配置表');
    } catch (e) {
      console.error('迁移失败:', e.message);
      throw e;
    }
  }
};
