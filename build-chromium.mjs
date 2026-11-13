import {copyFile, mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';

const directory = 'build/chromium';
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
manifest.manifest_version = 3;
manifest.minimum_chrome_version = '120';
manifest.permissions = ['storage', 'scripting'];
manifest.host_permissions = ['https://console.yandex.cloud/*'];
manifest.optional_host_permissions = ['https://*/*'];
delete manifest.optional_permissions;
delete manifest.browser_specific_settings;
manifest.background = {service_worker: 'chromium-background.js'};
manifest.action = {...manifest.browser_action, default_icon: 'icons/icon-128.png'};
delete manifest.browser_action;
manifest.icons = {'128': 'icons/icon-128.png'};
await mkdir(directory, {recursive: true});
await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
for (const file of ['chromium-background.js', 'browser-alias.js', 'content.css', 'icons/icon.svg', 'icons/icon-128.png', '_locales/en/messages.json', '_locales/ru/messages.json']) {
    await mkdir(path.dirname(path.join(directory, file)), {recursive: true});
    await copyFile(file, path.join(directory, file));
}
const options = await readFile('options.html', 'utf8');
await writeFile(path.join(directory, 'options.html'), options.replace('<script src="options.js"', '<script src="browser-alias.js" defer></script>\n  <script src="options.js"'));
console.log(path.resolve(directory));
