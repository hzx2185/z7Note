/**
 * 联系人 API 路由
 */

const express = require('express');
const { getConnection } = require('../db/connection');
const log = require('../utils/logger');
const VCardGenerator = require('../utils/vCardGenerator');
const VCardParser = require('../utils/vCardParser');

const router = express.Router();

// 生成唯一ID
function generateId() {
  return 'contact_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

// 字段名称映射（用于显示）
const fieldNames = {
  fn: '全名',
  n_family: '姓',
  n_given: '名',
  n_middle: '中间名',
  n_prefix: '前缀',
  n_suffix: '后缀',
  tel: '电话',
  email: '邮箱',
  adr: '地址',
  org: '公司',
  title: '职位',
  url: '网址',
  photo: '照片',
  note: '备注',
  bday: '生日',
  nickname: '昵称'
};

// 记录联系人历史
async function recordContactHistory(username, contactId, action, field, oldValue, newValue) {
  try {
    const db = getConnection();
    const now = Math.floor(Date.now() / 1000);

    await db.run(
      `INSERT INTO contact_history (contact_id, username, action, field, old_value, new_value, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [contactId, username, action, field, oldValue, newValue, now]
    );
  } catch (e) {
    log('ERROR', '记录联系人历史失败', { username, contactId, action, error: e.message });
  }
}

// 比较并记录字段变更
async function recordFieldChanges(username, contactId, oldData, newData) {
  const fields = ['fn', 'n_family', 'n_given', 'n_middle', 'n_prefix', 'n_suffix', 
                  'org', 'title', 'url', 'photo', 'note', 'bday', 'nickname'];
  
  for (const field of fields) {
    const oldVal = (oldData[field] || '').toString().trim();
    const newVal = (newData[field] || '').toString().trim();
    
    if (oldVal !== newVal) {
      await recordContactHistory(username, contactId, 'update', fieldNames[field] || field, oldVal || null, newVal || null);
    }
  }

  // 处理JSON字段（电话、邮箱、地址）
  const jsonFields = ['tel', 'email', 'adr'];
  for (const field of jsonFields) {
    const oldVal = oldData[field] ? JSON.stringify(JSON.parse(oldData[field])) : null;
    const newVal = newData[field] ? JSON.stringify(newData[field]) : null;
    
    if (oldVal !== newVal) {
      // 格式化显示
      let oldDisplay = null, newDisplay = null;
      try {
        if (oldVal) {
          const arr = JSON.parse(oldVal);
          oldDisplay = arr.map(item => `${item.type || ''}:${item.value || ''}`).join(', ');
        }
        if (newVal) {
          const arr = JSON.parse(newVal);
          newDisplay = arr.map(item => `${item.type || ''}:${item.value || ''}`).join(', ');
        }
      } catch (e) {
        oldDisplay = oldVal;
        newDisplay = newVal;
      }
      
      await recordContactHistory(username, contactId, 'update', fieldNames[field] || field, oldDisplay, newDisplay);
    }
  }
}

// 获取联系人列表
router.get('/', async (req, res) => {
  try {
    const { search, limit = 100, offset = 0 } = req.query;

    let query = 'SELECT id, fn, n_family, n_given, org, tel, email, createdAt FROM contacts WHERE username = ?';
    const params = [req.user];

    if (search) {
      query += ' AND (fn LIKE ? OR n_family LIKE ? OR n_given LIKE ? OR org LIKE ?)';
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern, searchPattern, searchPattern);
    }

    // 获取总数
    const countQuery = query.replace(/^SELECT id, fn, n_family, n_given, org, tel, email, createdAt FROM/, 'SELECT COUNT(*) as total FROM');
    const countResult = await getConnection().get(countQuery, params);
    const total = countResult.total;

    // 添加排序和分页
    query += ' ORDER BY fn ASC, createdAt DESC';
    query += ' LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const contacts = await getConnection().all(query, params);
    res.json({ contacts, total, limit: parseInt(limit), offset: parseInt(offset) });
  } catch (e) {
    log('ERROR', '获取联系人失败', { username: req.user, error: e.message });
    res.status(500).json({ error: '获取失败' });
  }
});

// 查找重复联系人 (必须在 /:id 之前)
router.get('/duplicates', async (req, res) => {
  try {
    // 优化查询:直接获取重复联系人的详细信息
    const duplicates = await getConnection().all(`
      SELECT 
        fn,
        COUNT(*) as count,
        GROUP_CONCAT(id) as ids
      FROM contacts
      WHERE username = ? AND fn IS NOT NULL AND fn != ''
      GROUP BY fn
      HAVING count > 1
      ORDER BY count DESC
    `, [req.user]);

    // 批量获取所有重复联系人的详细信息
    const formatted = [];
    const batchSize = 50; // 每批处理50个
    
    for (let i = 0; i < duplicates.length; i += batchSize) {
      const batch = duplicates.slice(i, i + batchSize);
      
      for (const dup of batch) {
        const ids = dup.ids.split(',');
        const contacts = await getConnection().all(
          `SELECT id, fn, tel, email, org, note FROM contacts WHERE id IN (${ids.map(() => '?').join(',')}) AND username = ?`,
          [...ids, req.user]
        );

        formatted.push({
          name: dup.fn,
          count: dup.count,
          contacts: contacts.map(c => ({
            id: c.id,
            fn: c.fn,
            tel: c.tel,
            email: c.email,
            org: c.org,
            note: c.note
          }))
        });
      }
    }

    res.json({ duplicates: formatted, total: formatted.length });
  } catch (e) {
    log('ERROR', '查找重复联系人失败', { username: req.user, error: e.message });
    res.status(500).json({ error: '查找失败' });
  }
});

// 智能查重 - 检测电话、邮箱、姓名重复
router.get('/smart-duplicates', async (req, res) => {
  try {
    const db = getConnection();
    const duplicates = {
      byName: [],      // 姓名重复
      byPhone: [],     // 电话重复
      byEmail: []      // 邮箱重复
    };

    // 1. 检测姓名重复
    const nameDuplicates = await db.all(`
      SELECT fn, COUNT(*) as count, GROUP_CONCAT(id) as ids
      FROM contacts
      WHERE username = ? AND fn IS NOT NULL AND fn != ''
      GROUP BY fn
      HAVING count > 1
      ORDER BY count DESC
      LIMIT 20
    `, [req.user]);

    for (const dup of nameDuplicates) {
      const ids = dup.ids.split(',');
      const contacts = await db.all(
        `SELECT id, fn, tel, email, org FROM contacts WHERE id IN (${ids.map(() => '?').join(',')}) AND username = ?`,
        [...ids, req.user]
      );
      duplicates.byName.push({
        type: 'name',
        field: '姓名',
        value: dup.fn,
        count: dup.count,
        contacts: contacts.map(c => ({
          id: c.id,
          fn: c.fn,
          tel: c.tel,
          email: c.email,
          org: c.org
        }))
      });
    }

    // 2. 检测电话重复
    const allContacts = await db.all(
      'SELECT id, fn, tel, email, org FROM contacts WHERE username = ? AND tel IS NOT NULL',
      [req.user]
    );

    const phoneMap = new Map();
    for (const contact of allContacts) {
      try {
        const tels = JSON.parse(contact.tel || '[]');
        for (const tel of tels) {
          if (tel.value) {
            // 规范化电话号码：去掉所有非数字字符
            const normalizedPhone = tel.value.replace(/\D/g, '');
            if (!phoneMap.has(normalizedPhone)) {
              phoneMap.set(normalizedPhone, []);
            }
            phoneMap.get(normalizedPhone).push({
              id: contact.id,
              fn: contact.fn,
              tel: contact.tel,
              email: contact.email,
              org: contact.org
            });
          }
        }
      } catch(e) {}
    }

    for (const [phone, contacts] of phoneMap) {
      if (contacts.length > 1) {
        duplicates.byPhone.push({
          type: 'phone',
          field: '电话',
          value: phone,
          count: contacts.length,
          contacts: contacts
        });
      }
    }

    // 3. 检测邮箱重复
    const emailContacts = await db.all(
      'SELECT id, fn, tel, email, org FROM contacts WHERE username = ? AND email IS NOT NULL',
      [req.user]
    );

    const emailMap = new Map();
    for (const contact of emailContacts) {
      try {
        const emails = JSON.parse(contact.email || '[]');
        for (const email of emails) {
          if (email.value) {
            if (!emailMap.has(email.value)) {
              emailMap.set(email.value, []);
            }
            emailMap.get(email.value).push({
              id: contact.id,
              fn: contact.fn,
              tel: contact.tel,
              email: contact.email,
              org: contact.org
            });
          }
        }
      } catch(e) {}
    }

    for (const [email, contacts] of emailMap) {
      if (contacts.length > 1) {
        duplicates.byEmail.push({
          type: 'email',
          field: '邮箱',
          value: email,
          count: contacts.length,
          contacts: contacts
        });
      }
    }

    const totalDuplicates = duplicates.byName.length + duplicates.byPhone.length + duplicates.byEmail.length;

    res.json({
      duplicates,
      total: totalDuplicates,
      summary: {
        nameDuplicates: duplicates.byName.length,
        phoneDuplicates: duplicates.byPhone.length,
        emailDuplicates: duplicates.byEmail.length
      }
    });
  } catch (e) {
    log('ERROR', '智能查重失败', { username: req.user, error: e.message });
    res.status(500).json({ error: '查重失败' });
  }
});

// 创建联系人
router.post('/', async (req, res) => {
  try {
    const { fn, n_family, n_given, n_middle, n_prefix, n_suffix, tel, email, adr, org, title, url, photo, note, bday, nickname } = req.body;

    // 数据验证
    if (!fn || !fn.trim()) {
      return res.status(400).json({ error: '姓名不能为空' });
    }

    // 规范化电话号码：去掉所有非数字字符（保留 + 号）
    let normalizedTel = tel;
    if (Array.isArray(tel)) {
      normalizedTel = tel.map(t => ({
        ...t,
        value: typeof t.value === 'string' ? t.value.replace(/[^\d+]/g, '') : t.value
      }));
    }

    const id = generateId();
    const uid = id;
    const now = Math.floor(Date.now() / 1000);

    // 生成 vCard
    const contactData = { fn, n_family, n_given, n_middle, n_prefix, n_suffix, tel: normalizedTel, email, adr, org, title, url, photo, note, bday, nickname, uid };
    const vcard = VCardGenerator.contactToVCard(contactData);

    await getConnection().run(
      `INSERT INTO contacts (
        id, username, uid, fn, n_family, n_given, n_middle, n_prefix, n_suffix,
        tel, email, adr, org, title, url, photo, note, bday, nickname, vcard,
        createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, req.user, uid, fn, n_family || '', n_given || '', n_middle || '', n_prefix || '', n_suffix || '',
        normalizedTel ? JSON.stringify(normalizedTel) : null,
        email ? JSON.stringify(email) : null,
        adr ? JSON.stringify(adr) : null,
        org || '', title || '', url || '', photo || '', note || '', bday || '', nickname || '',
        vcard, now, now
      ]
    );

    // 记录创建历史
    await recordContactHistory(req.user, id, 'create', null, null, fn);

    log('INFO', '创建联系人成功', { username: req.user, contactId: id, fn });
    res.status(201).json({ id, message: '创建成功' });
  } catch (e) {
    log('ERROR', '创建联系人失败', { username: req.user, error: e.message });
    res.status(500).json({ error: '创建失败' });
  }
});

// 更新联系人
router.put('/:id', async (req, res) => {
  try {
    const { fn, n_family, n_given, n_middle, n_prefix, n_suffix, tel, email, adr, org, title, url, photo, note, bday, nickname } = req.body;

    // 数据验证
    if (!fn || !fn.trim()) {
      return res.status(400).json({ error: '姓名不能为空' });
    }

    // 规范化电话号码：去掉所有非数字字符（保留 + 号）
    let normalizedTel = tel;
    if (Array.isArray(tel)) {
      normalizedTel = tel.map(t => ({
        ...t,
        value: typeof t.value === 'string' ? t.value.replace(/[^\d+]/g, '') : t.value
      }));
    }

    const existing = await getConnection().get(
      'SELECT * FROM contacts WHERE id = ? AND username = ?',
      [req.params.id, req.user]
    );
    if (!existing) {
      return res.status(404).json({ error: '联系人不存在' });
    }

    const now = Math.floor(Date.now() / 1000);

    // 生成 vCard
    const contactData = { fn, n_family, n_given, n_middle, n_prefix, n_suffix, tel: normalizedTel, email, adr, org, title, url, photo, note, bday, nickname };
    const vcard = VCardGenerator.contactToVCard(contactData);

    await getConnection().run(
      `UPDATE contacts SET
        fn = ?, n_family = ?, n_given = ?, n_middle = ?, n_prefix = ?, n_suffix = ?,
        tel = ?, email = ?, adr = ?, org = ?, title = ?, url = ?, photo = ?, note = ?,
        bday = ?, nickname = ?, vcard = ?, updatedAt = ?
      WHERE id = ? AND username = ?`,
      [
        fn, n_family || '', n_given || '', n_middle || '', n_prefix || '', n_suffix || '',
        normalizedTel ? JSON.stringify(normalizedTel) : null,
        email ? JSON.stringify(email) : null,
        adr ? JSON.stringify(adr) : null,
        org || '', title || '', url || '', photo || '', note || '', bday || '', nickname || '',
        vcard, now,
        req.params.id, req.user
      ]
    );

    // 记录字段变更历史
    await recordFieldChanges(req.user, req.params.id, existing, {
      fn, n_family, n_given, n_middle, n_prefix, n_suffix,
      tel: normalizedTel ? JSON.stringify(normalizedTel) : null,
      email: email ? JSON.stringify(email) : null,
      adr: adr ? JSON.stringify(adr) : null,
      org, title, url, photo, note, bday, nickname
    });

    log('INFO', '更新联系人成功', { username: req.user, contactId: req.params.id, fn });
    res.json({ message: '更新成功' });
  } catch (e) {
    log('ERROR', '更新联系人失败', { username: req.user, contactId: req.params.id, error: e.message });
    res.status(500).json({ error: '更新失败' });
  }
});

// 删除联系人
router.delete('/:id', async (req, res) => {
  try {
    // 先获取联系人信息用于记录历史
    const contact = await getConnection().get(
      'SELECT fn FROM contacts WHERE id = ? AND username = ?',
      [req.params.id, req.user]
    );

    if (!contact) {
      return res.status(404).json({ error: '联系人不存在' });
    }

    const result = await getConnection().run(
      'DELETE FROM contacts WHERE id = ? AND username = ?',
      [req.params.id, req.user]
    );

    if (result.changes === 0) {
      return res.status(404).json({ error: '联系人不存在' });
    }

    // 记录删除历史
    await recordContactHistory(req.user, req.params.id, 'delete', null, contact.fn, null);

    log('INFO', '删除联系人成功', { username: req.user, contactId: req.params.id });
    res.json({ message: '删除成功' });
  } catch (e) {
    log('ERROR', '删除联系人失败', { username: req.user, contactId: req.params.id, error: e.message });
    res.status(500).json({ error: '删除失败' });
  }
});

// 批量删除联系人
router.delete('/batch', async (req, res) => {
  try {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: '请选择要删除的联系人' });
    }

    const placeholders = ids.map(() => '?').join(',');
    const result = await getConnection().run(
      `DELETE FROM contacts WHERE id IN (${placeholders}) AND username = ?`,
      [...ids, req.user]
    );

    log('INFO', '批量删除联系人成功', { username: req.user, count: result.changes });
    res.json({ message: `成功删除 ${result.changes} 个联系人`, count: result.changes });
  } catch (e) {
    log('ERROR', '批量删除联系人失败', { username: req.user, error: e.message });
    res.status(500).json({ error: '删除失败' });
  }
});

// 合并重复联系人
router.post('/merge', async (req, res) => {
  try {
    const { keepId, mergeIds } = req.body;

    if (!keepId || !mergeIds || !Array.isArray(mergeIds) || mergeIds.length === 0) {
      return res.status(400).json({ error: '参数错误' });
    }

    const db = getConnection();
    const now = Math.floor(Date.now() / 1000);

    // 获取要保留的联系人
    const keepContact = await db.get(
      'SELECT * FROM contacts WHERE id = ? AND username = ?',
      [keepId, req.user]
    );

    if (!keepContact) {
      return res.status(404).json({ error: '联系人不存在' });
    }

    // 获取要合并的联系人
    const mergeContacts = await db.all(
      `SELECT * FROM contacts WHERE id IN (${mergeIds.map(() => '?').join(',')}) AND username = ?`,
      [...mergeIds, req.user]
    );

    // 合并电话号码
    let tels = [];
    try { tels = JSON.parse(keepContact.tel || '[]'); } catch(e) {}

    for (const contact of mergeContacts) {
      try {
        const contactTels = JSON.parse(contact.tel || '[]');
        contactTels.forEach(t => {
          // 规范化要合并的电话号码
          const normalizedVal = typeof t.value === 'string' ? t.value.replace(/[^\d+]/g, '') : t.value;
          if (!tels.find(existing => (typeof existing.value === 'string' ? existing.value.replace(/[^\d+]/g, '') : existing.value) === normalizedVal)) {
            tels.push({ ...t, value: normalizedVal });
          }
        });
      } catch(e) {}
    }

    // 再次规范化所有的电话
    tels = tels.map(t => ({
      ...t,
      value: typeof t.value === 'string' ? t.value.replace(/[^\d+]/g, '') : t.value
    }));

    // 合并邮箱
    let emails = [];
    try { emails = JSON.parse(keepContact.email || '[]'); } catch(e) {}

    for (const contact of mergeContacts) {
      try {
        const contactEmails = JSON.parse(contact.email || '[]');
        contactEmails.forEach(e => {
          if (!emails.find(existing => existing.value === e.value)) {
            emails.push(e);
          }
        });
      } catch(e) {}
    }

    // 合并备注
    let notes = keepContact.note || '';
    for (const contact of mergeContacts) {
      if (contact.note && contact.note !== notes) {
        notes += (notes ? '\n\n---\n\n' : '') + contact.note;
      }
    }

    // 更新保留的联系人
    await db.run(
      `UPDATE contacts SET
        tel = ?, email = ?, note = ?, updatedAt = ?
      WHERE id = ? AND username = ?`,
      [
        tels.length > 0 ? JSON.stringify(tels) : null,
        emails.length > 0 ? JSON.stringify(emails) : null,
        notes,
        now,
        keepId,
        req.user
      ]
    );

    // 删除要合并的联系人
    const placeholders = mergeIds.map(() => '?').join(',');
    const deleteResult = await db.run(
      `DELETE FROM contacts WHERE id IN (${placeholders}) AND username = ?`,
      [...mergeIds, req.user]
    );

    log('INFO', '合并联系人成功', {
      username: req.user,
      keepId,
      mergedCount: deleteResult.changes,
      telsCount: tels.length,
      emailsCount: emails.length
    });

    res.json({
      message: `成功合并 ${deleteResult.changes} 个联系人`,
      mergedCount: deleteResult.changes,
      telsCount: tels.length,
      emailsCount: emails.length
    });
  } catch (e) {
    log('ERROR', '合并联系人失败', { username: req.user, error: e.message });
    res.status(500).json({ error: '合并失败' });
  }
});

// 批量合并重复联系人
router.post('/merge-batch', async (req, res) => {
  try {
    const { mergeList } = req.body; // [{ keepId, mergeIds }, ...]

    if (!mergeList || !Array.isArray(mergeList) || mergeList.length === 0) {
      return res.status(400).json({ error: '参数错误' });
    }

    const db = getConnection();
    const now = Math.floor(Date.now() / 1000);
    let totalMerged = 0;
    let totalTels = 0;
    let totalEmails = 0;

    await db.run('BEGIN TRANSACTION');

    for (const item of mergeList) {
      const { keepId, mergeIds } = item;

      if (!keepId || !mergeIds || mergeIds.length === 0) continue;

      // 获取要保留的联系人
      const keepContact = await db.get(
        'SELECT * FROM contacts WHERE id = ? AND username = ?',
        [keepId, req.user]
      );

      if (!keepContact) continue;

      // 获取要合并的联系人
      const mergeContacts = await db.all(
        `SELECT * FROM contacts WHERE id IN (${mergeIds.map(() => '?').join(',')}) AND username = ?`,
        [...mergeIds, req.user]
      );

      // 合并电话号码
      let tels = [];
      try { tels = JSON.parse(keepContact.tel || '[]'); } catch(e) {}

      for (const contact of mergeContacts) {
        try {
          const contactTels = JSON.parse(contact.tel || '[]');
          contactTels.forEach(t => {
            // 规范化要合并的电话号码
            const normalizedVal = typeof t.value === 'string' ? t.value.replace(/[^\d+]/g, '') : t.value;
            if (!tels.find(existing => (typeof existing.value === 'string' ? existing.value.replace(/[^\d+]/g, '') : existing.value) === normalizedVal)) {
              tels.push({ ...t, value: normalizedVal });
            }
          });
        } catch(e) {}
      }

      // 再次规范化所有的电话
      tels = tels.map(t => ({
        ...t,
        value: typeof t.value === 'string' ? t.value.replace(/[^\d+]/g, '') : t.value
      }));

      // 合并邮箱
      let emails = [];
      try { emails = JSON.parse(keepContact.email || '[]'); } catch(e) {}

      for (const contact of mergeContacts) {
        try {
          const contactEmails = JSON.parse(contact.email || '[]');
          contactEmails.forEach(e => {
            if (!emails.find(existing => existing.value === e.value)) {
              emails.push(e);
            }
          });
        } catch(e) {}
      }

      // 合并备注
      let notes = keepContact.note || '';
      for (const contact of mergeContacts) {
        if (contact.note && contact.note !== notes) {
          notes += (notes ? '\n\n---\n\n' : '') + contact.note;
        }
      }

      // 更新保留的联系人
      await db.run(
        `UPDATE contacts SET tel = ?, email = ?, note = ?, updatedAt = ? WHERE id = ? AND username = ?`,
        [
          tels.length > 0 ? JSON.stringify(tels) : null,
          emails.length > 0 ? JSON.stringify(emails) : null,
          notes,
          now,
          keepId,
          req.user
        ]
      );

      // 删除要合并的联系人
      const placeholders = mergeIds.map(() => '?').join(',');
      const deleteResult = await db.run(
        `DELETE FROM contacts WHERE id IN (${placeholders}) AND username = ?`,
        [...mergeIds, req.user]
      );

      totalMerged += deleteResult.changes;
      totalTels += tels.length;
      totalEmails += emails.length;
    }

    await db.run('COMMIT');

    log('INFO', '批量合并联系人成功', {
      username: req.user,
      mergedCount: totalMerged,
      telsCount: totalTels,
      emailsCount: totalEmails
    });

    res.json({
      message: `成功合并 ${totalMerged} 个联系人`,
      mergedCount: totalMerged,
      telsCount: totalTels,
      emailsCount: totalEmails
    });
  } catch (e) {
    await getConnection().run('ROLLBACK');
    log('ERROR', '批量合并联系人失败', { username: req.user, error: e.message });
    res.status(500).json({ error: '合并失败' });
  }
});

// 导出 vCard
router.get('/export/:id', async (req, res) => {
  try {
    const contact = await getConnection().get(
      'SELECT * FROM contacts WHERE id = ? AND username = ?',
      [req.params.id, req.user]
    );
    if (!contact) return res.status(404).json({ error: '联系人不存在' });

    const vcard = VCardGenerator.contactToVCard(contact);
    const filename = `${contact.fn || 'contact'}.vcf`;

    res.setHeader('Content-Type', 'text/vcard; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.send(vcard);
  } catch (e) {
    log('ERROR', '导出联系人失败', { username: req.user, contactId: req.params.id, error: e.message });
    res.status(500).json({ error: '导出失败' });
  }
});

// 导出所有联系人
router.get('/export', async (req, res) => {
  try {
    const contacts = await getConnection().all(
      'SELECT * FROM contacts WHERE username = ?',
      [req.user]
    );

    const vcards = contacts.map(c => VCardGenerator.contactToVCard(c)).join('\r\n');
    const filename = `contacts_${Date.now()}.vcf`;

    res.setHeader('Content-Type', 'text/vcard; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.send(vcards);
  } catch (e) {
    log('ERROR', '导出联系人失败', { username: req.user, error: e.message });
    res.status(500).json({ error: '导出失败' });
  }
});

// 导入 vCard（支持批量导入，优化性能，防重复）
router.post('/import', async (req, res) => {
  const startTime = Date.now();
  let transaction = null;

  try {
    const { vcard: vcardContent } = req.body;

    if (!vcardContent) {
      return res.status(400).json({ error: 'vCard 内容不能为空' });
    }

    // 解析多个 vCard
    const contactsData = VCardParser.parseMultiple(vcardContent);

    if (!contactsData || contactsData.length === 0) {
      return res.status(400).json({ error: '未找到有效的联系人数据' });
    }

    const db = getConnection();
    const now = Math.floor(Date.now() / 1000);
    const importedContacts = [];
    const skippedContacts = [];

    // 开始事务
    await db.run('BEGIN TRANSACTION');

    // 批量插入联系人（使用事务，性能提升10倍以上）
    for (const contactData of contactsData) {
      // 检查重复（基于姓名）
      const existing = await db.get(
        'SELECT id FROM contacts WHERE username = ? AND fn = ?',
        [req.user, contactData.fn || '']
      );

      if (existing) {
        skippedContacts.push({ fn: contactData.fn, reason: '重复' });
        continue;
      }

      const id = generateId();

      await db.run(
        `INSERT INTO contacts (
          id, username, uid, fn, n_family, n_given, n_middle, n_prefix, n_suffix,
          tel, email, adr, org, title, url, photo, note, bday, nickname, vcard,
          createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, req.user, contactData.uid || id,
          contactData.fn || '', contactData.n_family || '', contactData.n_given || '',
          contactData.n_middle || '', contactData.n_prefix || '', contactData.n_suffix || '',
          contactData.tel || null, contactData.email || null, contactData.adr || null,
          contactData.org || '', contactData.title || '', contactData.url || '',
          contactData.photo || '', contactData.note || '', contactData.bday || '',
          contactData.nickname || '', contactData.vcard || vcardContent, now, now
        ]
      );

      importedContacts.push({ id, fn: contactData.fn });
    }

    // 提交事务
    await db.run('COMMIT');

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    log('INFO', '批量导入联系人成功', {
      username: req.user,
      total: contactsData.length,
      imported: importedContacts.length,
      skipped: skippedContacts.length,
      elapsed: `${elapsed}s`
    });

    res.status(201).json({
      message: `成功导入 ${importedContacts.length} 个联系人${skippedContacts.length > 0 ? `，跳过 ${skippedContacts.length} 个重复联系人` : ''}`,
      count: importedContacts.length,
      skipped: skippedContacts.length,
      total: contactsData.length,
      elapsed: `${elapsed}s`,
      contacts: importedContacts
    });
  } catch (e) {
    // 回滚事务
    try {
      await getConnection().run('ROLLBACK');
    } catch (rollbackError) {}

    log('ERROR', '导入联系人失败', { username: req.user, error: e.message, stack: e.stack });
    res.status(500).json({ error: '导入失败: ' + e.message });
  }
});

// 获取联系人修改历史
router.get('/:id/history', async (req, res) => {
  try {
    const { id } = req.params;
    
    const history = await getConnection().all(
      `SELECT * FROM contact_history 
       WHERE contact_id = ? AND username = ? 
       ORDER BY created_at DESC 
       LIMIT 50`,
      [id, req.user]
    );

    res.json({ history });
  } catch (e) {
    log('ERROR', '获取历史记录失败', { username: req.user, error: e.message });
    res.status(500).json({ error: '获取失败' });
  }
});

// 获取单个联系人（必须放在所有具体路由之后）
router.get('/:id', async (req, res) => {
  try {
    const contact = await getConnection().get(
      'SELECT * FROM contacts WHERE id = ? AND username = ?',
      [req.params.id, req.user]
    );
    if (!contact) return res.status(404).json({ error: '联系人不存在' });
    res.json(contact);
  } catch (e) {
    log('ERROR', '获取联系人失败', { username: req.user, contactId: req.params.id, error: e.message });
    res.status(500).json({ error: '获取失败' });
  }
});

module.exports = router;
