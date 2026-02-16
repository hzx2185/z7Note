
const path = require('path');
const dbPath = path.join(__dirname, 'data', 'z7note.db');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');

async function main() {
  try {
    const db = await open({
      filename: dbPath,
      driver: sqlite3.Database
    });

    console.log('=== 当前数据库状态 ===\n');

    const events = await db.all('SELECT * FROM events WHERE username = ?', ['snowfly']);
    console.log(`找到 ${events.length} 个事件:`);
    events.forEach(event => {
      console.log(`\n  - ID: ${event.id}`);
      console.log(`    标题: ${event.title}`);
      console.log(`    开始: ${new Date(event.startTime * 1000).toLocaleString()}`);
      console.log(`    结束: ${event.endTime ? new Date(event.endTime * 1000).toLocaleString() : 'null'}`);
      console.log(`    全天: ${event.allDay}`);
      console.log(`    重复: ${event.recurrence}`);
    });

    await db.close();
  } catch (error) {
    console.error('Error:', error);
  }
}

main();
