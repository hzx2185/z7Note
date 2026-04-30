const test = require('node:test');
const assert = require('node:assert/strict');

const VCardParser = require('../src/utils/vCardParser');

test('parses Apple grouped TEL properties from CardDAV vCards', () => {
  const contact = VCardParser.parse([
    'BEGIN:VCARD',
    'VERSION:3.0',
    'UID:apple-contact-1',
    'N:张;三;;;',
    'FN:张三',
    'item1.TEL;type=pref;type=CELL;type=VOICE;VALUE=uri:tel:+8613812345678',
    'item1.X-ABLabel:_$!<Mobile>!$_',
    'END:VCARD'
  ].join('\r\n'));

  assert.equal(contact.fn, '张三');
  assert.deepEqual(JSON.parse(contact.tel), [
    {
      type: 'pref,CELL,VOICE',
      value: '+8613812345678'
    }
  ]);
});

test('parses ungrouped TEL properties as before', () => {
  const contact = VCardParser.parse([
    'BEGIN:VCARD',
    'VERSION:3.0',
    'FN:Test User',
    'TEL;TYPE=CELL:13812345678',
    'END:VCARD'
  ].join('\r\n'));

  assert.deepEqual(JSON.parse(contact.tel), [
    {
      type: 'CELL',
      value: '13812345678'
    }
  ]);
});
