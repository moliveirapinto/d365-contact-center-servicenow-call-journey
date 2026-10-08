import { log } from './lib.mjs';

const only = process.argv.slice(2);
const steps = [
    ['01-schema', './steps/01-schema.mjs'],
    ['02-logic', './steps/02-logic.mjs'],
    ['03-ui', './steps/03-ui.mjs'],
    ['04-security', './steps/04-security.mjs'],
    ['05-rest', './steps/05-rest.mjs'],
    ['06-play', './steps/06-play.mjs'],
    ['07-open', './steps/07-open.mjs'],
    ['08-edge', './steps/08-edge.mjs']
];

for (const [name, file] of steps) {
    if (only.length && !only.some((o) => name.includes(o))) continue;
    log(`\n== ${name}`);
    try {
        const mod = await import(file);
        await mod.default();
    } catch (e) {
        if (e.code === 'ERR_MODULE_NOT_FOUND' && String(e.message).includes(file.replace('./', ''))) {
            log('  (step not implemented yet)');
            continue;
        }
        console.error(`  FAILED: ${e.message}`);
        process.exitCode = 1;
        break;
    }
}
log('\nDone.');

