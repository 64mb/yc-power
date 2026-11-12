import {build} from 'esbuild';
import {readFile, readdir, writeFile} from 'node:fs/promises';
import path from 'node:path';

const marker = '__YC_POWER_BUNDLED_GRAVITY_CSS__';
const shared = {
    bundle: true,
    format: 'iife',
    target: ['firefox109'],
    jsx: 'automatic',
    write: false,
    metafile: true,
    plugins: [{
        name: 'lodash-browser-global',
        setup(builder) {
            builder.onLoad({filter: /[/\\]lodash[/\\]_root\.js$/}, () => ({
                contents: 'module.exports = globalThis;',
                loader: 'js',
            }));
        },
    }],
    legalComments: 'none',
    define: {'process.env.NODE_ENV': '"production"'},
};
const result = await build({...shared,
    entryPoints: ['src/content.jsx'], outfile: 'content.js',
    define: {...shared.define, __YCP_GRAVITY_CSS__: JSON.stringify(marker)},
});
const options = await build({...shared, entryPoints: ['src/options.jsx'], outfile: 'options.js'});
for (const file of options.outputFiles) await writeFile(file.path, file.contents);
const javascript = result.outputFiles.find((file) => file.path.endsWith('.js'));
const stylesheet = result.outputFiles.find((file) => file.path.endsWith('.css'));
if (!javascript || !stylesheet || !javascript.text.includes(JSON.stringify(marker))) {
    throw new Error('Expected JavaScript, CSS, and the Gravity CSS placeholder');
}
await writeFile('content.js', javascript.text.replaceAll(JSON.stringify(marker), () => JSON.stringify(stylesheet.text)));

const packageDirectories = new Set();
const bundledInputs = new Set([...Object.values(result.metafile.outputs), ...Object.values(options.metafile.outputs)].flatMap((output) =>
    Object.entries(output.inputs).filter(([, details]) => details.bytesInOutput > 0).map(([name]) => name)));
for (const input of bundledInputs) {
    const parts = input.split('/');
    const index = parts.lastIndexOf('node_modules');
    if (index < 0) continue;
    const length = parts[index + 1].startsWith('@') ? index + 3 : index + 2;
    packageDirectories.add(parts.slice(0, length).join('/'));
}
const notices = ['Third-party software included in YC Power', ''];
for (const directory of [...packageDirectories].sort()) {
    const metadata = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
    const files = (await readdir(directory)).filter((name) => /^(licen[cs]e|copying|notice)(\.|$)/i.test(name)).sort();
    notices.push(`${metadata.name} ${metadata.version}`, `License: ${metadata.license || 'see below'}`, '');
    if (!files.length && metadata.name === '@bem-react/classname' && metadata.license === 'MPL-2.0') {
        notices.push('Source: https://github.com/bem/bem-react/tree/a6f87639c7540bde7864f4c25a0e125ce9296f28',
            await readFile('licenses/bem-react-MPL-2.0.txt', 'utf8'), '');
    } else if (!files.length) {
        throw new Error(`Missing license text for ${metadata.name}`);
    }
    for (const file of files) {
        notices.push(file, await readFile(path.join(directory, file), 'utf8'), '');
    }
}
await writeFile('THIRD_PARTY_NOTICES.txt', notices.join('\n'));
