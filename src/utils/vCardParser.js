/**
 * vCard 解析工具
 * 用于 CardDAV 联系人同步
 */

class VCardParser {
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
          const telType = params.TYPE || 'CELL';
          contact.tel.push({ type: telType, value: value });
          break;

        case 'EMAIL':
          const emailType = params.TYPE || 'INTERNET';
          contact.email.push({ type: emailType, value: value });
          break;

        case 'ADR':
          const adrType = params.TYPE || 'HOME';
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

    // 将数组转换为 JSON 字符串存储
    if (contact.tel.length === 0) delete contact.tel;
    else contact.tel = JSON.stringify(contact.tel);
    
    if (contact.email.length === 0) delete contact.email;
    else contact.email = JSON.stringify(contact.email);
    
    if (contact.adr.length === 0) delete contact.adr;
    else contact.adr = JSON.stringify(contact.adr);

    return contact;
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
    const name = parts[0];
    const params = {};

    for (let i = 1; i < parts.length; i++) {
      const param = parts[i];
      const eqIndex = param.indexOf('=');
      if (eqIndex !== -1) {
        const paramName = param.substring(0, eqIndex);
        const paramValue = param.substring(eqIndex + 1);
        params[paramName.toUpperCase()] = paramValue;
      } else {
        // 无值的参数（如 TYPE=CELL 可能写成 TYPE;CELL）
        params[param.toUpperCase()] = true;
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
