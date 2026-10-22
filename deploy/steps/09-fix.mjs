import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { upsert, log } from '../lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// The optional repair script that ships inside the update set (see servicenow/package/post-install-fix-script.js).
export default async function fix() {
    await upsert('sys_script_fix', 'name=D365CC - Post-install configuration', {
        name: 'D365CC - Post-install configuration',
        script: fs.readFileSync(path.join(root, 'servicenow', 'package', 'post-install-fix-script.js'), 'utf8'),
        active: 'true',
        description: 'Optional repair: re-creates the Contact Center Call form layouts, related lists and the softphone. Safe to run more than once.'
    });
    log('  fix script ok');
}
