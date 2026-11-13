import {spawnSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
const browser = process.argv[2];
if (!['firefox', 'chromium'].includes(browser)) throw new Error('Choose firefox or chromium');
const context = process.env.DOCKER_CONTEXT || (spawnSync('docker', ['info'], {stdio: 'ignore'}).status === 0 ? null : 'colima');
const prefix = context ? ['--context', context] : [];
function docker(args) {
    const result = spawnSync('docker', [...prefix, ...args], {stdio: 'inherit'});
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status || 1);
}
const output = resolve('build/test-results', browser);
mkdirSync(output, {recursive: true});
docker(['build', '-f', 'tests/Dockerfile', '-t', 'yc-power-browser-tests:local', '.']);
docker(['run', '--rm', '--init', '--network=none', '--read-only', '--tmpfs', '/tmp:rw,size=1g', '--shm-size=1g', '-e', 'HOME=/tmp', '-e', 'XDG_CONFIG_HOME=/tmp/config', '-e', 'XDG_CACHE_HOME=/tmp/cache', '--mount', `type=bind,source=${output},target=/app/test-results`, 'yc-power-browser-tests:local', 'xvfb-run', '-a', 'npx', 'playwright', 'test', `--project=${browser}`, ...process.argv.slice(3)]);
