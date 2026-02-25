/**
 * 清理重复联系人脚本
 * 用法: node scripts/cleanup-duplicates.js
 */

const { getConnection } = require('../src/db/connection');

async function cleanupDuplicates() {
  const db = getConnection();

  try {
    console.log('开始查找重复联系人...');

    // 查找重复的联系人（基于用户和姓名）
    const duplicates = await db.all(`
      SELECT username, fn, COUNT(*) as count, GROUP_CONCAT(id) as ids
      FROM contacts
      GROUP BY username, fn
      HAVING count > 1
    `);

    if (duplicates.length === 0) {
      console.log('没有发现重复联系人');
      return;
    }

    console.log(`发现 ${duplicates.length} 组重复联系人:`);

    let totalDeleted = 0;

    for (const dup of duplicates) {
      const ids = dup.ids.split(',');
      const keepId = ids[0]; // 保留第一个
      const deleteIds = ids.slice(1); // 删除其余的

      console.log(`\n用户: ${dup.username}, 姓名: ${dup.fn}, 重复数: ${dup.count}`);
      console.log(`  保留: ${keepId}`);
      console.log(`  删除: ${deleteIds.join(', ')}`);

      // 删除重复的联系人
      for (const id of deleteIds) {
        await db.run('DELETE FROM contacts WHERE id = ?', [id]);
        totalDeleted++;
      }
    }

    console.log(`\n清理完成! 共删除 ${totalDeleted} 个重复联系人`);
  } catch (error) {
    console.error('清理失败:', error);
    process.exit(1);
  }
}

// 运行清理
cleanupDuplicates().then(() => {
  process.exit(0);
});
