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

// 获取联系人列表
router.get('/api/contacts', async (req, res) => {
  try {
    const { search } = req.query;
    
    let query = 'SELECT * FROM contacts WHERE username = ?';
    const params = [req.user];
    
    if (search) {
      query += ' AND (fn LIKE ? OR n_family LIKE ? OR n_given LIKE ? OR org LIKE ?)';
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern, searchPattern, searchPattern);
    }
    
    query += ' ORDER BY fn ASC, createdAt DESC';
    
    const contacts = await getConnection().all(query, params);
    res.json(contacts);
  } catch (e) {
    log('ERROR', '获取联系人失败', { username: req.user, error: e.message });
    res.status(500).json({ error: '获取失败' });
  }
});

// 获取单个联系人
router.get('/api/contacts/:id', async (req, res) => {
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

// 创建联系人
router.post('/api/contacts', async (req, res) => {
  try {
    const { fn, n_family, n_given, n_middle, n_prefix, n_suffix, tel, email, adr, org, title, url, photo, note, bday, nickname } = req.body;
    
    // 数据验证
    if (!fn || !fn.trim()) {
      return res.status(400).json({ error: '姓名不能为空' });
    }
    
    const id = generateId();
    const uid = id;
    const now = Math.floor(Date.now() / 1000);
    
    // 生成 vCard
    const contactData = { fn, n_family, n_given, n_middle, n_prefix, n_suffix, tel, email, adr, org, title, url, photo, note, bday, nickname, uid };
    const vcard = VCardGenerator.contactToVCard(contactData);
    
    await getConnection().run(
      `INSERT INTO contacts (
        id, username, uid, fn, n_family, n_given, n_middle, n_prefix, n_suffix,
        tel, email, adr, org, title, url, photo, note, bday, nickname, vcard,
        createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, req.user, uid, fn, n_family || '', n_given || '', n_middle || '', n_prefix || '', n_suffix || '',
        tel ? JSON.stringify(tel) : null,
        email ? JSON.stringify(email) : null,
        adr ? JSON.stringify(adr) : null,
        org || '', title || '', url || '', photo || '', note || '', bday || '', nickname || '',
        vcard, now, now
      ]
    );
    
    log('INFO', '创建联系人成功', { username: req.user, contactId: id, fn });
    res.status(201).json({ id, message: '创建成功' });
  } catch (e) {
    log('ERROR', '创建联系人失败', { username: req.user, error: e.message });
    res.status(500).json({ error: '创建失败' });
  }
});

// 更新联系人
router.put('/api/contacts/:id', async (req, res) => {
  try {
    const { fn, n_family, n_given, n_middle, n_prefix, n_suffix, tel, email, adr, org, title, url, photo, note, bday, nickname } = req.body;
    
    // 数据验证
    if (!fn || !fn.trim()) {
      return res.status(400).json({ error: '姓名不能为空' });
    }
    
    const existing = await getConnection().get(
      'SELECT id FROM contacts WHERE id = ? AND username = ?',
      [req.params.id, req.user]
    );
    if (!existing) {
      return res.status(404).json({ error: '联系人不存在' });
    }
    
    const now = Math.floor(Date.now() / 1000);
    
    // 生成 vCard
    const contactData = { fn, n_family, n_given, n_middle, n_prefix, n_suffix, tel, email, adr, org, title, url, photo, note, bday, nickname };
    const vcard = VCardGenerator.contactToVCard(contactData);
    
    await getConnection().run(
      `UPDATE contacts SET 
        fn = ?, n_family = ?, n_given = ?, n_middle = ?, n_prefix = ?, n_suffix = ?,
        tel = ?, email = ?, adr = ?, org = ?, title = ?, url = ?, photo = ?, note = ?,
        bday = ?, nickname = ?, vcard = ?, updatedAt = ?
      WHERE id = ? AND username = ?`,
      [
        fn, n_family || '', n_given || '', n_middle || '', n_prefix || '', n_suffix || '',
        tel ? JSON.stringify(tel) : null,
        email ? JSON.stringify(email) : null,
        adr ? JSON.stringify(adr) : null,
        org || '', title || '', url || '', photo || '', note || '', bday || '', nickname || '',
        vcard, now,
        req.params.id, req.user
      ]
    );
    
    log('INFO', '更新联系人成功', { username: req.user, contactId: req.params.id, fn });
    res.json({ message: '更新成功' });
  } catch (e) {
    log('ERROR', '更新联系人失败', { username: req.user, contactId: req.params.id, error: e.message });
    res.status(500).json({ error: '更新失败' });
  }
});

// 删除联系人
router.delete('/api/contacts/:id', async (req, res) => {
  try {
    const result = await getConnection().run(
      'DELETE FROM contacts WHERE id = ? AND username = ?',
      [req.params.id, req.user]
    );
    
    if (result.changes === 0) {
      return res.status(404).json({ error: '联系人不存在' });
    }
    
    log('INFO', '删除联系人成功', { username: req.user, contactId: req.params.id });
    res.json({ message: '删除成功' });
  } catch (e) {
    log('ERROR', '删除联系人失败', { username: req.user, contactId: req.params.id, error: e.message });
    res.status(500).json({ error: '删除失败' });
  }
});

// 导出 vCard
router.get('/api/contacts/export/:id', async (req, res) => {
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
router.get('/api/contacts/export', async (req, res) => {
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

// 导入 vCard
router.post('/api/contacts/import', async (req, res) => {
  try {
    const { vcard: vcardContent } = req.body;
    
    if (!vcardContent) {
      return res.status(400).json({ error: 'vCard 内容不能为空' });
    }
    
    // 解析 vCard
    const contactData = VCardParser.parse(vcardContent);
    const id = generateId();
    const now = Math.floor(Date.now() / 1000);
    
    await getConnection().run(
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
        contactData.nickname || '', vcardContent, now, now
      ]
    );
    
    log('INFO', '导入联系人成功', { username: req.user, contactId: id, fn: contactData.fn });
    res.status(201).json({ id, message: '导入成功', fn: contactData.fn });
  } catch (e) {
    log('ERROR', '导入联系人失败', { username: req.user, error: e.message });
    res.status(500).json({ error: '导入失败' });
  }
});

module.exports = router;
