<div align="center">
  <img src="icons/icon.svg" alt="YC Power icon" width="96">
  <h1>YC Power</h1>
  <p>A focused cloud navigation panel for the Yandex Cloud console</p>
</div>

YC Power brings your frequently used clouds and folders together in a compact sidebar for Firefox, Zen, and Chromium. Your selection and customizations stay in local browser storage, separately for each organization and console origin.

![YC Power workspace with a selection of clouds and folders](docs/screenshots/workspace.png)

## Make the console yours

- Add or remove clouds from **My clouds**; refresh clouds and their folders together from the header
- See selected clouds from multiple organizations together in collapsible groups; existing selections and customizations stay separate for each organization
- Display the previous local catalog immediately while refreshing it in the background; detect console tree creation immediately and check readiness every 50 ms for up to five seconds
- Open **All clouds** to use the original console tree and add clouds from it, or return to the default sidebar, including during loading
- Background collection pauses while you use the original tree and resumes when you return to My clouds and close the full list
- Get automatic short names and colors, then override either with your own label and one of 32 preset colors in the Power and Material palettes
- Choose one of 24 Gravity UI icons for each folder; clouds keep their original icon when folders are enabled, and support icon presets in clouds-only mode
- Set individual console addresses to clouds-only mode to hide folders and skip background folder loading
- Use the header button to show all clouds in the new style when an organization has fewer than 10 clouds
- Drag clouds to reorder My clouds, or use Alt+Up/Down; the order is saved for each organization
- Sort folders alphabetically by their displayed labels, keeping their order stable during refresh
- Keep confirmed empty clouds collapsed
- Remember expanded clouds and automatically reveal the cloud you navigate to
- Keep selected clouds, labels, colors, and sidebar width separate for every organization
- Use compact Gravity UI actions and drag the sidebar edge to adjust its width, with an automatic minimum that keeps the actions on one line and a 440 px maximum
- Start with the current cloud automatically selected when it can be identified on first use
- Enable compact mode in extension settings to reduce row height and spacing
- Export settings as two-space-indented JSON and import them across browsers; imported settings are staged until you select **Save**, when the browser requests any required permissions
- Follow the console's Gravity theme and font, including light and dark themes
- Use Russian or English according to the console language; extension settings follow the browser language, with English as the fallback

| Customize a cloud or folder | Choose console origins |
| --- | --- |
| ![Label and color customization](docs/screenshots/customize.png) | ![Extension settings](docs/screenshots/settings.png) |

Screenshots use the real console interface with demo cloud and folder names. The console layout and branding are unchanged.

## Browser support and access

YC Power supports desktop Firefox 140 and later and compatible versions of Zen. A separate Manifest V3 development build supports Chromium 120 and later, including the Orca browser. Android has not been tested.

By default the extension runs only on `https://console.yandex.cloud`. Use the extension icon to add other HTTPS console origins. The browser requests permission for each added origin. Enter an origin without a path, port, or parameters; an empty list disables the extension on all consoles. See [PRIVACY.md](PRIVACY.md) for details about data and permissions.

## Install

When a Mozilla-signed XPI is attached to a [release](https://github.com/64mb/yc-power/releases/latest), install it through `about:addons` using "Install Add-on From File". A source ZIP is not an installation package. For an unsigned local build, use the temporary installation instructions below. Updates keep the same extension ID and preserve your settings.

## Build and test

Node.js 24 or later and npm are required. React and Gravity UI are bundled locally. All build and test scripts use JavaScript; Python is not required.

```sh
npm ci
npm run build:firefox
npm run test:firefox
npm run smoke:firefox
```

The Firefox build creates the reproducible `build/yc-power-firefox.xpi` archive with sorted entries, fixed timestamps and file permissions. It contains the extension and `THIRD_PARTY_NOTICES.txt` for bundled dependencies.

`npm run test:shared` runs browser-independent unit tests. `npm run test:firefox` and `npm run test:chromium` each run those shared tests and their browser background adapter tests. The smoke commands use `tests/run-browser-tests.mjs` to run Playwright exclusively in Docker against local synthetic fixtures. Docker must be running; no browser installation or host Keychain access is required. The runner uses the default Docker context when available, falls back to `colima`, and honors `DOCKER_CONTEXT` when set.

## Chromium development build

```sh
npm run build:chromium
npm run test:chromium
npm run smoke:chromium
```

The build creates the unpacked extension in `build/chromium`, independently of the Firefox XPI. Open `chrome://extensions` in Chromium, enable Developer mode, choose **Load unpacked**, and select that directory. Use Orca's browser extension settings to load the same directory where supported. Reload the extension after rebuilding it.

The Chromium build uses a Manifest V3 service worker and persistent content script registration. It applies the same per-origin permissions and browser-local settings as Firefox, and injects into matching tabs that are already open. Settings are separate between browsers and profiles. This is an unpacked development build, not a signed or store-published package.

## Install for development

Open `about:debugging#/runtime/this-firefox` in Firefox or Zen, choose "Load Temporary Add-on", and select the XPI or `manifest.json`. A temporary add-on is removed when the browser restarts.
