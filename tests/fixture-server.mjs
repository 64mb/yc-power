import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
const root = resolve('.');
const types = {'.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png'};
createServer(async (request, response) => {
    try {
        const filename = resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
        if (!filename.startsWith(root + sep)) throw new Error('Invalid path');
        const data = await readFile(filename);
        response.writeHead(200, {'content-type': types[extname(filename)] || 'application/octet-stream'});
        response.end(data);
    } catch { response.writeHead(404); response.end(); }
}).listen(4173, '127.0.0.1');
