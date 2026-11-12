export const messages = {
    en: {
        settings: 'Extension settings', domains: 'Console addresses',
        intro: 'Choose where to show My Clouds. Your browser will ask for access to each new address.',
        address: 'Console address', remove: 'Remove address', add: 'Add address', save: 'Save',
        placeholder: 'https://console.example.com',
        empty: 'No addresses. Saving will disable the extension on all consoles.',
        hint: 'HTTPS only, without paths or parameters. Names, colors, and your cloud list are stored separately for each address and stay in your browser.',
        privacy: 'YC Power does not manage cloud resources or send settings to a server.',
        loadFailed: 'Could not load settings. Please reopen this page.',
        denied: 'Access was not granted. Settings have not changed.',
        saved: 'Saved. The extension is enabled for the selected addresses.',
        disabled: 'Saved. The extension is disabled on all addresses.',
        saveFailed: 'Could not save settings. Please try again.',
        https: 'Enter a full address starting with https://',
        invalid: 'Enter a valid HTTPS address without a path, port, parameters, or login details.',
    },
    ru: {
        settings: 'Настройки расширения', domains: 'Адреса консолей',
        intro: 'Выберите, где показывать "Мои облака". Для каждого нового адреса браузер запросит доступ.',
        address: 'Адрес консоли', remove: 'Удалить адрес', add: 'Добавить адрес', save: 'Сохранить',
        placeholder: 'https://console.example.com',
        empty: 'Адресов нет. После сохранения расширение будет отключено на всех консолях.',
        hint: 'Только HTTPS, без пути и параметров. Названия, цвета и список облаков сохраняются отдельно для каждого адреса и остаются в браузере.',
        privacy: 'YC Power не управляет ресурсами облака и не отправляет настройки на сервер.',
        loadFailed: 'Не удалось загрузить настройки. Откройте эту страницу еще раз.',
        denied: 'Доступ не предоставлен. Настройки не изменены.',
        saved: 'Сохранено. Расширение подключено к выбранным адресам.',
        disabled: 'Сохранено. Расширение отключено на всех адресах.',
        saveFailed: 'Не удалось сохранить настройки. Попробуйте еще раз.',
        https: 'Укажите полный адрес, начинающийся с https://',
        invalid: 'Укажите корректный HTTPS-адрес без пути, порта, параметров и данных пользователя.',
    },
};

export function getLanguage(browserAPI = globalThis.browser, navigatorAPI = globalThis.navigator) {
    let locale;
    try { locale = browserAPI?.i18n?.getUILanguage(); } catch { /* use the navigator language when browser detection fails */ }
    const language = (locale || navigatorAPI?.language || 'en').toLowerCase().split(/[-_]/)[0];
    return language === 'ru' ? 'ru' : 'en';
}
