# Reviewer build instructions

YC Power uses React and Gravity UI bundled locally with esbuild. It does not download or execute remote code at runtime.

Build tools: Node.js 24.15.0, npm 11.12.1, Python 3.9 or newer. The submitted package was built on macOS; the same scripts also support Linux. Install Node.js from https://nodejs.org/ and Python from https://www.python.org/ if required.

From the source archive root:

```sh
npm ci
npm run build
```

The resulting package is `build/yc-power-firefox.xpi`. The lockfile pins all dependencies. No credentials, private services, browser profile, or environment file are required for building. Signing is performed separately by Mozilla.

To verify behavior with unit tests in the repository, run `npm test`. Tests are not part of the reviewer source archive.

For functional review, open https://console.yandex.cloud and sign in with your own account. The extension customizes the existing navigation tree, adds selected clouds to My Clouds, and stores preferences locally. It does not create or modify cloud resources. Additional console addresses are optional and require the user's permission. Russian and English interfaces are supported.
