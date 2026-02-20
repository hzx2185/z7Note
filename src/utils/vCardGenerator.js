/**
 * vCard 文件生成工具
 * 用于 CardDAV 联系人同步
 */

class VCardGenerator {
  /**
   * 将联系人转换为 vCard 格式
   */
  static contactToVCard(contact) {
    const lines = [];

    // vCard 开始
    lines.push('BEGIN:VCARD');
    lines.push('VERSION:3.0');

    // UID（唯一标识符）
    lines.push(`UID:${contact.uid || contact.id}`);

    // FN（全名）
    if (contact.fn) {
      lines.push(`FN:${this.escapeText(contact.fn)}`);
    }

    // N（姓名结构：姓;名;中间名;前缀;后缀）
    const nParts = [
      contact.n_family || '',
      contact.n_given || '',
      contact.n_middle || '',
      contact.n_prefix || '',
      contact.n_suffix || ''
    ];
    lines.push(`N:${nParts.map(p => this.escapeText(p)).join(';')}`);

    // TEL（电话）
    if (contact.tel) {
      try {
        const tels = typeof contact.tel === 'string' ? JSON.parse(contact.tel) : contact.tel;
        if (Array.isArray(tels)) {
          tels.forEach(tel => {
            if (tel.value) {
              const type = tel.type ? `TYPE=${tel.type.toUpperCase()}` : 'TYPE=CELL';
              lines.push(`TEL;${type}:${tel.value}`);
            }
          });
        }
      } catch (e) {
        // 如果解析失败，直接作为字符串处理
        if (contact.tel) {
          lines.push(`TEL;TYPE=CELL:${contact.tel}`);
        }
      }
    }

    // EMAIL（邮箱）
    if (contact.email) {
      try {
        const emails = typeof contact.email === 'string' ? JSON.parse(contact.email) : contact.email;
        if (Array.isArray(emails)) {
          emails.forEach(email => {
            if (email.value) {
              const type = email.type ? `TYPE=${email.type.toUpperCase()}` : 'TYPE=INTERNET';
              lines.push(`EMAIL;${type}:${email.value}`);
            }
          });
        }
      } catch (e) {
        if (contact.email) {
          lines.push(`EMAIL;TYPE=INTERNET:${contact.email}`);
        }
      }
    }

    // ADR（地址）
    if (contact.adr) {
      try {
        const adrs = typeof contact.adr === 'string' ? JSON.parse(contact.adr) : contact.adr;
        if (Array.isArray(adrs)) {
          adrs.forEach(adr => {
            if (adr.value) {
              const type = adr.type ? `TYPE=${adr.type.toUpperCase()}` : 'TYPE=HOME';
              // 地址格式：邮编;街道;城市;州/省;国家
              const adrParts = adr.value.split(';');
              while (adrParts.length < 5) adrParts.push('');
              lines.push(`ADR;${type}:;;${adrParts[1]};${adrParts[2]};${adrParts[3]};${adrParts[0]};${adrParts[4]}`);
            }
          });
        }
      } catch (e) {
        // 忽略解析错误
      }
    }

    // ORG（组织）
    if (contact.org) {
      lines.push(`ORG:${this.escapeText(contact.org)}`);
    }

    // TITLE（职位）
    if (contact.title) {
      lines.push(`TITLE:${this.escapeText(contact.title)}`);
    }

    // URL（网址）
    if (contact.url) {
      lines.push(`URL:${contact.url}`);
    }

    // BDAY（生日）
    if (contact.bday) {
      lines.push(`BDAY:${contact.bday}`);
    }

    // NICKNAME（昵称）
    if (contact.nickname) {
      lines.push(`NICKNAME:${this.escapeText(contact.nickname)}`);
    }

    // PHOTO（照片）
    if (contact.photo) {
      // 假设照片是 base64 编码
      if (contact.photo.startsWith('data:')) {
        // data:image/jpeg;base64,xxxxx
        const match = contact.photo.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          lines.push(`PHOTO;ENCODING=b;TYPE=${match[1].split('/')[1].toUpperCase()}:${match[2]}`);
        }
      } else {
        lines.push(`PHOTO;ENCODING=b:${contact.photo}`);
      }
    }

    // NOTE（备注）
    if (contact.note) {
      lines.push(`NOTE:${this.escapeText(contact.note)}`);
    }

    // REV（修订时间）
    const modified = contact.updatedAt || contact.createdAt || Date.now();
    const modifiedDate = new Date(modified * 1000);
    lines.push(`REV:${this.formatDateTime(modifiedDate)}`);

    // PRODID
    lines.push('PRODID:-//z7Note//CardDAV Server//CN');

    // vCard 结束
    lines.push('END:VCARD');

    return lines.join('\r\n');
  }

  /**
   * 生成完整的 vCard 地址簿
   */
  static generateAddressBook(contacts, username) {
    const lines = [];

    // 添加所有联系人
    if (contacts && contacts.length > 0) {
      contacts.forEach(contact => {
        lines.push(this.contactToVCard(contact));
      });
    }

    return lines.join('\r\n');
  }

  /**
   * 格式化日期时间（YYYYMMDDTHHMMSSZ）
   */
  static formatDateTime(date) {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    const seconds = String(date.getUTCSeconds()).padStart(2, '0');
    return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
  }

  /**
   * 转义 vCard 文本中的特殊字符
   */
  static escapeText(text) {
    if (!text) return '';
    
    // 转义特殊字符
    text = text.replace(/\\/g, '\\\\'); // 反斜杠
    text = text.replace(/;/g, '\\;');   // 分号
    text = text.replace(/,/g, '\\,');   // 逗号
    text = text.replace(/\n/g, '\\n');  // 换行
    
    return text;
  }
}

module.exports = VCardGenerator;
