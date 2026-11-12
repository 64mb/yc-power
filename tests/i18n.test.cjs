const {test} = require('node:test');
const assert = require('node:assert/strict');
const {messages, language, translate} = require('../panel-i18n.js');
test('uses console language independently of the browser language', () => {
  assert.equal(language('ru', '', 'en-US'), 'ru');
  assert.equal(language('en-US', '', 'ru-RU'), 'en');
  assert.equal(language('', 'Фильтр по облакам', 'en-US'), 'ru');
  assert.equal(language('', 'Filter clouds', 'ru-RU'), 'en');
  assert.equal(language('', '', 'ru-RU'), 'ru');
  assert.equal(language('fr', '', 'ru-RU'), 'en');
});
test('provides both languages for every panel status and control', () => {
  assert.deepEqual(Object.keys(messages.en).sort(), Object.keys(messages.ru).sort());
  assert.equal(translate('en', 'folders', {name:'My cloud'}), 'Folders in My cloud');
  assert.equal(translate('ru', 'folders', {name:'My cloud'}), 'Каталоги в My cloud');
  assert.equal(translate('en', 'cloudCount', {count:373}), '373 clouds');
});
