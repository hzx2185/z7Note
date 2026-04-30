  /**
   * vCard 解析工具
   * 用于 CardDAV 联系人同步
   */
  const log = require('./logger');

  class VCardParser {
    static normalizeWhitespace(text) {
      return (text || '').replace(/\s+/g, ' ').trim();
    }

    static compactName(text) {
      return this.normalizeWhitespace(text).replace(/\s+/g, '');
    }

    static containsCJK(text) {
      return /[\u3400-\u9fff\uf900-\ufaff]/.test(text || '');
    }

    static isLikelyCJKStructuredName(contact) {
      return this.containsCJK(contact.n_family) && this.containsCJK(contact.n_given);
    }

    static getPropertyName(rawName) {
      const name = String(rawName || '').trim();
      const dotIndex = name.lastIndexOf('.');
      return dotIndex >= 0 ? name.slice(dotIndex + 1) : name;
    }

    static normalizeTypeParam(type, fallback) {
      if (!type) return fallback;
      if (Array.isArray(type)) return type.filter(Boolean).join(',');
      return String(type);
    }

    static normalizeTelephoneValue(value) {
      let text = this.unescapeText(value || '').trim();
      if (/^tel:/i.test(text)) {
        text = text.replace(/^tel:/i, '');
        try {
          text = decodeURIComponent(text);
        } catch (error) {
          // 保留原始 tel URI 内容
        }
      }
      return text;
    }

    static buildStructuredDisplayName(contact) {
      const family = contact.n_family || '';
      const given = contact.n_given || '';
      const middle = contact.n_middle || '';
      const prefix = contact.n_prefix || '';
      const suffix = contact.n_suffix || '';

      if (!family && !given && !middle && !prefix && !suffix) {
        return '';
      }

      if (this.isLikelyCJKStructuredName(contact)) {
        return `${prefix}${family}${given}${middle}${suffix}`.trim();
      }

      return this.normalizeWhitespace([prefix, given, middle, family, suffix].filter(Boolean).join(' '));
    }

    static normalizeFormattedName(contact) {
      const structuredDisplay = this.buildStructuredDisplayName(contact);
      const formattedName = this.normalizeWhitespace(contact.fn);

      if (!formattedName) {
        return structuredDisplay;
      }

      if (!structuredDisplay) {
        return formattedName;
      }

      if (this.isLikelyCJKStructuredName(contact)) {
        const compactFormatted = this.compactName(formattedName);
        const compactStructured = this.compactName(structuredDisplay);
        const compactReverse = this.compactName(`${contact.n_given || ''}${contact.n_family || ''}${contact.n_middle || ''}`);

        if (compactFormatted === compactReverse || compactFormatted === compactStructured) {
          return structuredDisplay;
        }
      }

      return formattedName;
    }

    /**
     * 解析 vCard 内容为联系人对象
     */
    static parse(vcardContent) {
      const contact = {
        tel: [],
        email: [],
        adr: []
      };

      // 规范化换行符
      const content = vcardContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

      // 展开折行（以空格开头的行是上一行的续行）
      const lines = [];
      let currentLine = '';
      content.split('\n').forEach(line => {
        if (line.startsWith(' ') || line.startsWith('\t')) {
          currentLine += line.substring(1);
        } else {
          if (currentLine) lines.push(currentLine);
          currentLine = line;
        }
      });
      if (currentLine) lines.push(currentLine);

      // 解析每一行
      for (const line of lines) {
        if (line.startsWith('BEGIN:') || line.startsWith('END:') || line.startsWith('VERSION:')) {
          continue;
        }

        const parsed = this.parseLine(line);
        if (!parsed) continue;

        const { name, params, value } = parsed;

        switch (name.toUpperCase()) {
          case 'UID':
            contact.uid = value;
            break;

          case 'FN':
            contact.fn = this.unescapeText(value);
            break;

          case 'N':
            const nParts = value.split(';').map(p => this.unescapeText(p));
            contact.n_family = nParts[0] || '';
            contact.n_given = nParts[1] || '';
            contact.n_middle = nParts[2] || '';
            contact.n_prefix = nParts[3] || '';
            contact.n_suffix = nParts[4] || '';
            break;

          case 'TEL':
            const telType = this.normalizeTypeParam(params.TYPE, 'CELL');
            contact.tel.push({ type: telType, value: this.normalizeTelephoneValue(value) });
            break;

          case 'EMAIL':
            const emailType = this.normalizeTypeParam(params.TYPE, 'INTERNET');
            contact.email.push({ type: emailType, value: value });
            break;

          case 'ADR':
            const adrType = this.normalizeTypeParam(params.TYPE, 'HOME');
            // 地址格式：邮编;街道;城市;州/省;国家
            const adrParts = value.split(';');
            // vCard ADR 格式: PO Box;Extended Addr;Street;City;Region;Postal Code;Country
            const street = adrParts[2] || '';
            const city = adrParts[3] || '';
            const region = adrParts[4] || '';
            const postalCode = adrParts[5] || '';
            const country = adrParts[6] || '';
            contact.adr.push({
              type: adrType,
              value: `${postalCode};${street};${city};${region};${country}`
            });
            break;

          case 'ORG':
            contact.org = this.unescapeText(value);
            break;

          case 'TITLE':
            contact.title = this.unescapeText(value);
            break;

          case 'URL':
            contact.url = value;
            break;

          case 'BDAY':
            contact.bday = value;
            break;

          case 'NICKNAME':
            contact.nickname = this.unescapeText(value);
            break;

          case 'PHOTO':
            if (params.ENCODING === 'b' || params.ENCODING === 'B') {
              const photoType = params.TYPE || 'JPEG';
              contact.photo = `data:image/${photoType.toLowerCase()};base64,${value}`;
            }
            break;

          case 'NOTE':
            contact.note = this.unescapeText(value);
            break;

          case 'REV':
            // 修订时间，可以忽略或存储
            break;
        }
      }

      contact.fn = this.normalizeFormattedName(contact);

      // 将数组转换为 JSON 字符串存储
      if (contact.tel.length === 0) delete contact.tel;
      else contact.tel = JSON.stringify(contact.tel);

      if (contact.email.length === 0) delete contact.email;
      else contact.email = JSON.stringify(contact.email);

      if (contact.adr.length === 0) delete contact.adr;
      else contact.adr = JSON.stringify(contact.adr);

      // 存储原始vCard内容
      contact.vcard = content;

      return contact;
    }

    /**
     * 解析多个 vCard 内容（支持批量导入）
     */
    static parseMultiple(vcardContent) {
      const contacts = [];

      // 规范化换行符
      const content = vcardContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

      // 分割多个 vCard 块
      const vcardBlocks = this.splitVCardBlocks(content);

      // 解析每个 vCard 块
      for (const block of vcardBlocks) {
        if (block.trim()) {
          try {
            const contact = this.parse(block);
            contacts.push(contact);
          } catch (e) {
            log('ERROR', '解析 vCard 块失败', { error: e.message, stack: e.stack });
          }
        }
      }

      return contacts;
    }

    /**
     * 分割 vCard 内容为多个 vCard 块
     */
    static splitVCardBlocks(content) {
      const blocks = [];
      let currentBlock = '';
      let inVCard = false;

      const lines = content.split('\n');
      for (const line of lines) {
        if (line.trim().startsWith('BEGIN:VCARD')) {
          inVCard = true;
          currentBlock = line + '\n';
        } else if (line.trim().startsWith('END:VCARD')) {
          inVCard = false;
          currentBlock += line + '\n';
          blocks.push(currentBlock);
          currentBlock = '';
        } else if (inVCard) {
          currentBlock += line + '\n';
        }
      }

      return blocks;
    }

    /**
     * 解析单行 vCard 属性
     */
    static parseLine(line) {
      // 格式: NAME;PARAM1=VALUE1;PARAM2=VALUE2:CONTENT
      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) return null;

      const nameAndParams = line.substring(0, colonIndex);
      const value = line.substring(colonIndex + 1);

      // 解析名称和参数
      const parts = nameAndParams.split(';');
      const name = this.getPropertyName(parts[0]);
      const params = {};

      for (let i = 1; i < parts.length; i++) {
        const param = parts[i];
        const eqIndex = param.indexOf('=');
        if (eqIndex !== -1) {
          const paramName = param.substring(0, eqIndex);
          const paramValue = param.substring(eqIndex + 1);
          const key = paramName.toUpperCase();
          if (key === 'TYPE' && params.TYPE) {
            params.TYPE = Array.isArray(params.TYPE) ? [...params.TYPE, paramValue] : [params.TYPE, paramValue];
          } else {
            params[key] = paramValue;
          }
        } else {
          // 无值的 TYPE 参数（如 TEL;CELL;VOICE:...）
          const key = param.toUpperCase();
          if (['CELL', 'VOICE', 'HOME', 'WORK', 'PREF', 'FAX', 'MAIN', 'IPHONE'].includes(key)) {
            params.TYPE = params.TYPE
              ? (Array.isArray(params.TYPE) ? [...params.TYPE, key] : [params.TYPE, key])
              : key;
          } else {
            params[key] = true;
          }
        }
      }

      return { name, params, value };
    }

    /**
     * 反转义 vCard 文本
     */
    static unescapeText(text) {
      if (!text) return '';

      text = text.replace(/\\n/g, '\n');  // 换行
      text = text.replace(/\\,/g, ',');   // 逗号
      text = text.replace(/\\;/g, ';');   // 分号
      text = text.replace(/\\\\/g, '\\'); // 反斜杠

      return text;
    }

    /**
     * 从 vCard 内容中提取 UID
     */
    static extractUID(vcardContent) {
      const match = vcardContent.match(/UID:(.+?)(?:\r?\n|$)/i);
      return match ? match[1].trim() : null;
    }

    /**
     * 从 vCard 内容中提取 FN（全名）
     */
    static extractFN(vcardContent) {
      const match = vcardContent.match(/FN:(.+?)(?:\r?\n|$)/i);
      return match ? this.unescapeText(match[1].trim()) : null;
    }
  }

  module.exports = VCardParser;
