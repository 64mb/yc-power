# Chrome Web Store listing: YC Power 1.5.0

## Store details

- Category: Productivity (Developer Tools if the dashboard offers it as the better fit)
- Homepage: https://github.com/64mb/yc-power
- Privacy policy: https://github.com/64mb/yc-power/blob/main/PRIVACY.md

### Short description

A customizable sidebar for navigating clouds and folders in the Yandex Cloud console

### Description

YC Power brings your frequently used clouds and folders together in a compact sidebar for the Yandex Cloud console.

- Select and reorder clouds, and organize them by organization
- Customize labels, colors, and folder icons
- Use clouds-only mode for individual console addresses
- Add other HTTPS console addresses, including regional consoles, with your permission
- Transfer settings and the navigation cache between browsers using a JSON file
- Use English or Russian and the console's light or dark theme

To build the sidebar, YC Power reads cloud and folder names, IDs, organization groups, and links displayed by the console. It stores a navigation cache and your preferences locally in the browser. Export and import use a local file only when you choose them. YC Power does not send this data to a developer server or collect analytics.

YC Power is an independent extension and is not affiliated with Yandex Cloud.

## Privacy and permissions

### Single purpose

Provide a customizable sidebar for navigating clouds and folders in the Yandex Cloud console.

### Permission justifications

- `storage`: save console addresses, sidebar preferences, selected clouds, customizations, and the navigation cache in local browser storage
- `scripting`: register the bundled sidebar scripts for enabled console origins and apply them to already open matching tabs
- `https://console.yandex.cloud/*`: run the sidebar on the default public console
- Optional `https://*/*`: allow users to add other HTTPS console origins; access is requested for the origins they configure and save

The extension uses bundled code and does not execute remotely hosted code. It does not collect analytics or change cloud resources. Expanding clouds uses the console's existing controls and requests.

### Data disclosure notes

YC Power reads console page content locally, including cloud and folder names and IDs, organization groups and links, and uses the current route to follow navigation. It saves the navigation cache and preferences locally. User-initiated JSON export and import use a local file containing settings and cached navigation data; the extension does not upload it. The developer does not receive this data.

Google requires disclosure of user data handling even when processing or storage is local ([User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)). Assess website content and any other applicable data categories against the actual dashboard questions and the extension's behavior before selecting checkboxes. Do not assume local processing means no user data is handled. Review the current disclosure and consent requirements before submission.
