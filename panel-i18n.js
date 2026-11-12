'use strict';

const messages = {
  en: {
    dragCloud: 'Drag to reorder', reorderCloud: 'Reorder {name}. Use Alt+Arrow Up or Alt+Arrow Down', cloudMoved: '{name}: position {position} of {count}',
    icons: 'Icons',
    icon_folder: 'Folder', icon_terminal: 'Terminal', icon_server: 'Server', icon_database: 'Database', icon_briefcase: 'Workspace', icon_network: 'Network', icon_container: 'Container', icon_git: 'Git branches', icon_cpu: 'CPU', icon_security: 'Security', icon_globe: 'Internet', icon_key: 'Credentials', icon_rocket: 'Deployment', icon_settings: 'Settings', icon_disk: 'Storage', icon_archive: 'Archive', icon_monitoring: 'Monitoring', icon_alerts: 'Alerts', icon_testing: 'Testing', icon_bug: 'Debugging', icon_connection: 'Connection', icon_layers: 'Environments', icon_clock: 'Scheduled jobs', icon_code: 'Code',
    power: 'Power', material: 'Material',
    showMyClouds: 'Show my clouds', mine: 'My clouds', all: 'All clouds', refresh: 'Refresh clouds',
    showAllModern: 'Show all organization clouds in this panel', organizationUnknown: 'Organization not detected',
    native: 'Default sidebar', back: 'Back to my clouds', add: 'Add to my clouds', remove: 'Remove from my clouds',
    folders: 'Folders in {name}', customize: 'Customize {name}', customizeTitle: 'Label and color', customizeFolderTitle: 'Label, color and icon',
    empty: 'Use the plus button in the full cloud list to add your clouds.', noFolders: 'No folders', refreshFolders: 'Refresh folders',
    label: 'Label', color: 'Color', hex: 'Color in HEX', palette: 'Color palette', save: 'Save', auto: 'Auto', cancel: 'Cancel',
    width: 'Sidebar width', reading: 'Reading the console tree…', saveFailed: 'Could not save settings',
    clearSearch: 'Clear the search in the original list, then refresh', loadingFolders: 'Loading folders…',
    scanning: 'Loading cloud list…', cloudCount: '{count} clouds', notFound: 'Cloud not found. Check the original list',
    scanFailed: 'Could not read the tree. The original list is available',
  },
  ru: {
    dragCloud: 'Перетащите для изменения порядка', reorderCloud: 'Порядок облака {name}. Используйте Alt+стрелка вверх или Alt+стрелка вниз', cloudMoved: '{name}: позиция {position} из {count}',
    icons: 'Иконки',
    icon_folder: 'Каталог', icon_terminal: 'Терминал', icon_server: 'Сервер', icon_database: 'База данных', icon_briefcase: 'Рабочая область', icon_network: 'Сеть', icon_container: 'Контейнер', icon_git: 'Ветки Git', icon_cpu: 'Процессор', icon_security: 'Безопасность', icon_globe: 'Интернет', icon_key: 'Учетные данные', icon_rocket: 'Развертывание', icon_settings: 'Настройки', icon_disk: 'Хранилище', icon_archive: 'Архив', icon_monitoring: 'Мониторинг', icon_alerts: 'Уведомления', icon_testing: 'Тестирование', icon_bug: 'Отладка', icon_connection: 'Соединение', icon_layers: 'Окружения', icon_clock: 'Расписание', icon_code: 'Код',
    power: 'Power', material: 'Material',
    showMyClouds: 'Показать мои облака', mine: 'Мои облака', all: 'Все облака', refresh: 'Обновить облака',
    showAllModern: 'Показывать все облака организации в этой панели', organizationUnknown: 'Организация не определена',
    native: 'Панель по умолчанию', back: 'Вернуться к моим облакам', add: 'Добавить в мои облака', remove: 'Убрать из моих облаков',
    folders: 'Каталоги в {name}', customize: 'Настроить {name}', customizeTitle: 'Подпись и цвет', customizeFolderTitle: 'Подпись, цвет и иконка',
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
