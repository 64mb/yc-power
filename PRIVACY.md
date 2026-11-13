# YC Power privacy

YC Power changes cloud navigation in the console. It does not manage cloud resources, collect analytics, or send settings to a server.

The extension reads the cloud and folder names, IDs, organization groups, and links already rendered by the console. It uses them to build the sidebar. Expanding a cloud uses the console's existing controls and requests.

Selected cloud IDs and their order, custom labels, colors, folder icons, sidebar width, and display preferences are stored in the extension's local browser storage, separately for each organization and console origin. A local cache of cloud and folder names, IDs, organization groups, and console links lets the sidebar display previous results while refreshing them in the background. The configured list of console addresses, per-address clouds-only mode, organization collapse state, and compact-mode preference are also stored locally. These settings are not synchronized to a developer service.

You can export settings and the local navigation cache to a JSON file and import that file in another browser. The file includes configured console addresses, cloud and folder names and IDs, and customization preferences. Export and import happen only when you choose them; the extension does not upload the file to a server. Browser permissions for imported console addresses are requested when you save the imported settings.

The default permission covers only `https://console.yandex.cloud`. Additional HTTPS origins require the browser's permission when you save them. Removing a custom origin revokes its optional permission. An empty list disables the extension everywhere.

The sidebar follows the console language. Extension settings use the browser interface language, then the system language, with English as the fallback. Russian and English are supported.
