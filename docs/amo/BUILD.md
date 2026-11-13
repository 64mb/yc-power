# Reviewer build instructions

YC Power uses React and Gravity UI bundled locally with esbuild. It does not download or execute remote code at runtime.

Build tools: Node.js 24 or later and npm. The scripts support macOS and Linux. Install Node.js from https://nodejs.org/ if required. Python and external archive tools are not required.

From the source archive root:

```sh
npm ci
npm run build:firefox
```

The resulting package is `build/yc-power-firefox.xpi`. The lockfile pins all dependencies. The archive uses sorted entries, fixed timestamps and file permissions. No credentials, private services, browser profile, or environment file are required for building. Signing is performed separately by Mozilla.

The reviewer source archive must include `package.json`, `package-lock.json`, `build.mjs`, `package-firefox.mjs`, `src/`, `licenses/`, `manifest.json`, `background.js`, `core.js`, `panel-i18n.js`, `settings-transfer.js`, `content.css`, `icons/`, `options.html`, and `_locales/`. Generated bundles and the XPI are rebuilt by the command above.

To verify behavior with unit tests in the repository, run `npm run test:firefox`. This runs shared unit tests and Firefox background adapter tests. `npm run test:chromium` covers the shared tests and Chromium adapter, and `npm run test:shared` runs the shared tests alone. UI regression commands are `npm run smoke:firefox` and `npm run smoke:chromium`. They run Playwright exclusively in Docker through `tests/run-browser-tests.mjs`, so Docker must be running but host browser installation and Keychain access are unnecessary. The runner uses the default Docker context when available, falls back to `colima`, and honors `DOCKER_CONTEXT` when set. Tests are not part of the reviewer source archive.

For functional review, open https://console.yandex.cloud and sign in with your own account. The extension customizes the existing navigation tree, adds selected clouds to My Clouds, and stores preferences locally. It does not create or modify cloud resources. Additional console addresses are optional and require the user's permission. Russian and English interfaces are supported.
