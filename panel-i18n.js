'use strict';

const messages = {
  en: {
    power: 'Power', material: 'Material',
    showMyClouds: 'Show my clouds', mine: 'My clouds', all: 'All clouds', refresh: 'Refresh clouds',
    showAllModern: 'Show all organization clouds in this panel', organizationUnknown: 'Organization not detected',
    native: 'Original sidebar', back: 'Back to my clouds', add: 'Add to my clouds', remove: 'Remove from my clouds',
    folders: 'Folders in {name}', customize: 'Customize {name}', customizeTitle: 'Label and color',
    empty: 'Use the plus button in the full cloud list to add your clouds.', noFolders: 'No folders', refreshFolders: 'Refresh folders',
    label: 'Label', color: 'Color', hex: 'Color in HEX', palette: 'Color palette', save: 'Save', auto: 'Auto', cancel: 'Cancel',
    width: 'Sidebar width', reading: 'Reading the console tree…', saveFailed: 'Could not save settings',
    clearSearch: 'Clear the search in the original list, then refresh', loadingFolders: 'Loading folders…',
    scanning: 'Loading cloud list…', cloudCount: '{count} clouds', notFound: 'Cloud not found. Check the original list',
    scanFailed: 'Could not read the tree. The original list is available',
  },
  ru: {
    power: 'Power', material: 'Material',
    showMyClouds: 'Показать мои облака', mine: 'Мои облака', all: 'Все облака', refresh: 'Обновить облака',
    showAllModern: 'Показывать все облака организации в этой панели', organizationUnknown: 'Организация не определена',
    native: 'Штатная панель', back: 'Вернуться к моим облакам', add: 'Добавить в мои облака', remove: 'Убрать из моих облаков',
    folders: 'Каталоги в {name}', customize: 'Настроить {name}', customizeTitle: 'Подпись и цвет',
    empty: 'Добавьте нужные облака кнопкой плюса в общем списке облаков', noFolders: 'Нет каталогов', refreshFolders: 'Обновить каталоги',
    label: 'Подпись', color: 'Цвет', hex: 'Цвет в HEX', palette: 'Палитра цвета', save: 'Сохранить', auto: 'Авто', cancel: 'Отмена',
    width: 'Ширина панели', reading: 'Читаю дерево консоли…', saveFailed: 'Не удалось сохранить настройки',
    clearSearch: 'Очистите поиск в штатном списке и нажмите обновить', loadingFolders: 'Загружаю каталоги…',
    scanning: 'Собираю список облаков…', cloudCount: 'Облака: {count}', notFound: 'Облако не найдено. Проверьте штатный список',
    scanFailed: 'Не удалось прочитать дерево. Доступен штатный список',
  },
};
function language(documentLanguage, placeholder = '', browserLanguage = 'en') {
  if (documentLanguage) return /^ru(?:-|$)/i.test(documentLanguage) ? 'ru' : 'en';
  if (/[а-я]/i.test(placeholder)) return 'ru';
  if (/cloud|folder|filter/i.test(placeholder)) return 'en';
  return /^ru(?:-|$)/i.test(browserLanguage) ? 'ru' : 'en';
}
function translate(locale, key, params = {}) {
  return (messages[locale]?.[key] || messages.en[key] || key).replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ''));
}
module.exports = {messages, language, translate};
