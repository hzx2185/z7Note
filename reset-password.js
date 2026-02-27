const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'z7note.db');
const username = process.argv[2] || 'snowfly';
const newPassword = process.argv[3] || 'test123456';

const db = new sqlite3.Database(dbPath, async (err) => {
  if (err) {
    console.error('数据库连接失败:', err);
    process.exit(1);
  }

  console.log(`正在为用户 ${username} 重置密码为 ${newPassword}...`);

  try {
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await new Promise((resolve, reject) => {
      db.run('UPDATE users SET password = ? WHERE username = ?', [hashedPassword, username], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // 验证密码
    const row = await new Promise((resolve, reject) => {
      db.get('SELECT password FROM users WHERE username = ?', [username], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    const match = await bcrypt.compare(newPassword, row.password);
    console.log(`✓ 密码已重置成功！验证结果: ${match}`);
    console.log(`用户名: ${username}`);
    console.log(`密码: ${newPassword}`);
  } catch (error) {
    console.error('重置密码失败:', error);
    process.exit(1);
  } finally {
    db.close();
  }
});
