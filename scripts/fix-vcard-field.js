#!/usr/bin/env node

/**
 * 修复联系人的vcard字段
 *
 * 问题：批量导入时，每个联系人的vcard字段存储了整个导入文件的所有vCard记录
 * 解决：为每个联系人重新生成单个vCard
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const VCardGenerator = require('../src/utils/vCardGenerator');

async function fixVcardField() {
  console.log('开始修复联系人vcard字段...\n');

  const dbPath = path.join(__dirname, '../data/z7note.db');
  const db = new sqlite3.Database(dbPath);

  try {
    // 查找所有包含多个vCard的记录（通过检测多个END:VCARD标记）
    const contacts = await new Promise((resolve, reject) => {
      db.all(
        'SELECT * FROM contacts WHERE vcard LIKE "%END:VCARD%END:VCARD%"',
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });

    console.log(`找到 ${contacts.length} 个需要修复的联系人\n`);

    if (contacts.length === 0) {
      console.log('没有需要修复的联系人，退出。');
      return;
    }

    let fixedCount = 0;
    let totalSavedBytes = 0;

    for (const contact of contacts) {
      const oldSize = Buffer.byteLength(contact.vcard || '', 'utf8');

      // 使用VCardGenerator重新生成单个vCard
      const vcard = VCardGenerator.contactToVCard(contact);
      const newSize = Buffer.byteLength(vcard, 'utf8');

      // 更新数据库
      await new Promise((resolve, reject) => {
        db.run(
          'UPDATE contacts SET vcard = ?, updatedAt = ? WHERE id = ?',
          [vcard, Math.floor(Date.now() / 1000), contact.id],
          function(err) {
            if (err) reject(err);
            else resolve();
          }
        );
      });

      fixedCount++;
      totalSavedBytes += (oldSize - newSize);

      // 每100个显示一次进度
      if (fixedCount % 100 === 0) {
        console.log(`已修复 ${fixedCount}/${contacts.length} 个联系人，节省空间: ${(totalSavedBytes / 1024 / 1024).toFixed(2)} MB`);
      }
    }

    console.log(`\n✅ 修复完成！`);
    console.log(`   - 共修复 ${fixedCount} 个联系人`);
    console.log(`   - 节省空间: ${(totalSavedBytes / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   - 平均每个联系人节省: ${(totalSavedBytes / 1024 / fixedCount).toFixed(2)} KB`);

    // 关闭数据库连接
    await new Promise((resolve, reject) => {
      db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

  } catch (error) {
    console.error('\n❌ 修复失败:', error.message);
    console.error(error.stack);
    db.close();
    throw error;
  }
}

// 执行修复
fixVcardField()
  .then(() => {
    console.log('\n数据修复完成！建议执行VACUUM清理碎片空间。');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n数据修复失败:', error);
    process.exit(1);
  });
