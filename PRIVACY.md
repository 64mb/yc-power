# YC Power privacy

YC Power changes cloud navigation in the console. It does not manage cloud resources, collect analytics, or send settings to a server.

The extension reads the cloud and folder names, IDs, organization groups, and links already rendered by the console. It uses them to build the sidebar. Expanding a cloud uses the console's existing controls and requests.

Selected cloud IDs, custom labels, colors, folder icons, sidebar width, and display preferences are stored in the extension's local browser storage, separately for each organization and console origin. A local cache of cloud and folder names, IDs, organization groups, and console links lets the sidebar display previous results while refreshing them in the background. The configured list of console addresses and compact-mode preference are also stored locally. These settings are not synchronized to a developer service.

The default permission covers only `https://console.yandex.cloud`. Additional HTTPS origins require the browser's permission when you save them. Removing a custom origin revokes its optional permission. An empty list disables the extension everywhere.

The sidebar follows the console language. Extension settings use the browser interface language, then the system language, with English as the fallback. Russian and English are supported.
