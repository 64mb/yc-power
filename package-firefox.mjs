import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {deflateRawSync} from 'node:zlib';

const root = path.dirname(fileURLToPath(import.meta.url));
const files = [
    'manifest.json', 'background.js', 'content.js', 'content.css', 'icons/icon.svg',
    'options.html', 'options.js', 'options.css', 'THIRD_PARTY_NOTICES.txt',
    '_locales/en/messages.json', '_locales/ru/messages.json',
].sort();
const output = path.join(root, 'build/yc-power-firefox.xpi');
const table = Uint32Array.from({length: 256}, (_, index) => {
    for (let bit = 0; bit < 8; bit++) index = (index >>> 1) ^ ((index & 1) ? 0xedb88320 : 0);
    return index >>> 0;
});
const crc32 = (data) => {
    let crc = 0xffffffff;
    for (const byte of data) crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff];
    return (crc ^ 0xffffffff) >>> 0;
};

const localEntries = [];
const centralEntries = [];
let offset = 0;
for (const file of files) {
    const data = await readFile(path.join(root, file));
    const name = Buffer.from(file);
    const compressed = deflateRawSync(data);
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(33, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    localEntries.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(33, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((0o100644 * 65536) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centralEntries.push(central, name);
    offset += local.length + name.length + compressed.length;
}
const central = Buffer.concat(centralEntries);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(central.length, 12);
end.writeUInt32LE(offset, 16);
await mkdir(path.dirname(output), {recursive: true});
await writeFile(output, Buffer.concat([...localEntries, central, end]));
console.log(output);
