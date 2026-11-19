import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdirSync, mkdtempSync, renameSync, rmSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
const browser = process.argv[2];
if (!['firefox', 'chromium'].includes(browser)) throw new Error('Choose firefox or chromium');
const context = process.env.DOCKER_CONTEXT || (spawnSync('docker', ['info'], {stdio: 'ignore'}).status === 0 ? null : 'colima');
const prefix = context ? ['--context', context] : [];
function docker(args, allowFailure = false) {
    const result = spawnSync('docker', [...prefix, ...args], {stdio: 'inherit'});
    if (allowFailure) {
        if (result.error) console.error(result.error);
        return result;
    }
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status || 1);
}
const output = resolve('build/test-results', browser);
mkdirSync(output, {recursive: true});
docker(['build', '-f', 'tests/Dockerfile', '-t', 'yc-power-browser-tests:local', '.']);
const container = `yc-power-${browser}-${randomUUID()}`;
const exitCode = result => result?.status === 0 ? 0 : result?.status || 1;
let runResult, copyResult, cleanupResult, staging;
try {
    runResult = docker(['run', '--detach', '--name', container, '--init', '--network=none', '--read-only', '--tmpfs', '/tmp:rw,size=1g', '--shm-size=1g', '-e', 'HOME=/tmp', '-e', 'XDG_CONFIG_HOME=/tmp/config', '-e', 'XDG_CACHE_HOME=/tmp/cache', '--mount', `type=bind,source=${output},target=/app/test-results`, 'yc-power-browser-tests:local', 'node', '-e', 'setInterval(() => {}, 60000)'], true);
    if (exitCode(runResult) === 0) {
        runResult = docker(['exec', container, 'xvfb-run', '-a', 'npx', 'playwright', 'test', `--project=${browser}`, ...process.argv.slice(3)], true);
    }
} finally {
    try {
        staging = mkdtempSync(join(dirname(output), `${browser}-artifacts-`));
        copyResult = docker(['cp', `${container}:/app/test-results/.`, staging], true);
        if (exitCode(copyResult) === 0) {
            rmSync(output, {recursive: true, force: true});
            renameSync(staging, output);
        }
    } catch (error) {
        console.error(error);
        copyResult = {status: 1};
    } finally {
        try {
            if (staging) rmSync(staging, {recursive: true, force: true});
        } catch (error) {
            console.error(error);
            copyResult = {status: 1};
        } finally {
            cleanupResult = docker(['rm', '-f', container], true);
        }
    }
}
process.exitCode = exitCode(runResult) || exitCode(copyResult) || exitCode(cleanupResult);
