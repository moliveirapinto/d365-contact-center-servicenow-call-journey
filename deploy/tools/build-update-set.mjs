// Builds the ServiceNow update set for a new release from the previous one plus the records that changed on the
// development instance. Usage: node deploy/tools/build-update-set.mjs 1.0.2 1.0.3
// The records listed in RECORDS are exported from the instance in .env.local (?UNL) and replace or extend the
// entries of the previous update set. Run `node deploy/deploy.mjs 04-security 08-edge` first so they are current.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { cfg, api, find } from '../lib.mjs';

const [from = '1.0.2', to = '1.0.3'] = process.argv.slice(2);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkgDir = path.join(root, 'servicenow', 'package');
const src = path.join(pkgDir, `D365_ContactCenter_CallJourney_ServiceNow_UpdateSet_${from}.xml`);
const dst = path.join(pkgDir, `D365_ContactCenter_CallJourney_ServiceNow_UpdateSet_${to}.xml`);

// [table, query, update type label]
const RECORDS = [
    ['sn_openframe_configuration', 'name=Dynamics 365 Contact Center', 'OpenFrame Configuration'],
    ['sys_script', 'name=D365CC - Update softphone URL', 'Business Rule'],
    ['sys_script_fix', 'name=D365CC - Post-install configuration', 'Fix Script'],
    ['sys_ui_page', 'name=d365cc_edge', 'UI Page'],
    ['sys_ui_script', 'name=d365cc_edge_host', 'UI Script'],
    ['sys_properties', 'name=d365cc.edge_url', 'System Property'],
    ['sys_properties', 'name=d365cc.edge_layout', 'System Property']
];

const DESCRIPTION = 'Dynamics 365 Contact Center call journey for ServiceNow CSM: Contact Center Call table and fields, call journey card, '
    + 'Case button and call picker, recording &amp; transcript pop-up, Case activity entry, form layouts, related lists, the REST API for '
    + 'the D365 flows, and the softphone: the new Dynamics 365 Contact Center Edge desktop in OpenFrame through the page /d365cc_edge.do. '
    + 'After committing, set the d365cc.* system properties, give agents the role sn_openframe_user, open /cache.do once and hard-refresh the Workspace.';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const hex = () => crypto.randomBytes(16).toString('hex');
const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
const auth = 'Basic ' + Buffer.from(`${cfg.user}:${cfg.pass}`).toString('base64');

async function exportRecord(table, sysId) {
    const res = await fetch(`https://${cfg.instance}/${table}.do?UNL&sysparm_query=sys_id=${sysId}`, { headers: { Authorization: auth } });
    if (!res.ok) throw new Error(`export ${table} ${sysId}: HTTP ${res.status}`);
    const xml = await res.text();
    const m = xml.match(new RegExp(`<${table} action="INSERT_OR_UPDATE">[\\s\\S]*?</${table}>`));
    if (!m) throw new Error(`export ${table} ${sysId}: record not found in unload`);
    return m[0];
}

// The fix script ships from servicenow/package/post-install-fix-script.js; push it to the instance before exporting.
const fix = await find('sys_script_fix', 'name=D365CC - Post-install configuration');
if (!fix) throw new Error('Fix script "D365CC - Post-install configuration" not found on the instance.');
await api('PATCH', `/api/now/table/sys_script_fix/${fix.sys_id}`, { script: fs.readFileSync(path.join(pkgDir, 'post-install-fix-script.js'), 'utf8') });

let xml = fs.readFileSync(src, 'utf8');
const oldSet = xml.match(/<sys_remote_update_set[\s\S]*?<sys_id>([0-9a-f]{32})<\/sys_id>/)[1];
const oldName = xml.match(/<sys_remote_update_set[\s\S]*?<name>([^<]+)<\/name>/)[1];
const newSet = hex();
const newName = `D365 Contact Center - Call Journey ${to}`;

for (const [table, query, type] of RECORDS) {
    const rec = await find(table, query, 'sys_id');
    if (!rec) throw new Error(`${table} ${query} not found on the instance.`);
    const name = `${table}_${rec.sys_id}`;
    let inner = await exportRecord(table, rec.sys_id);
    if (table === 'sys_properties' && /<name>d365cc\.org_url<\/name>/.test(inner)) throw new Error('Never export d365cc.org_url');
    const target = (inner.match(/<name>([^<]*)<\/name>/) || [])[1] || name;
    const payload = `<?xml version="1.0" encoding="UTF-8"?><record_update table="${table}">${inner}</record_update>`;
    const guid = hex();
    const entry = `<sys_update_xml action="INSERT_OR_UPDATE"><action>INSERT_OR_UPDATE</action><application display_value="Global">global</application>`
        + `<category>customer</category><comments/><name>${name}</name><payload>${esc(payload)}</payload><payload_hash/>`
        + `<remote_update_set display_value="${oldName}">${oldSet}</remote_update_set><replace_on_upgrade>false</replace_on_upgrade>`
        + `<sys_created_by>admin</sys_created_by><sys_created_on>${now}</sys_created_on><sys_id>${hex()}</sys_id><sys_mod_count>0</sys_mod_count>`
        + `<sys_recorded_at>${now}</sys_recorded_at><sys_updated_by>admin</sys_updated_by><sys_updated_on>${now}</sys_updated_on>`
        + `<target_name>${esc(target)}</target_name><type>${type}</type><update_domain>global</update_domain><update_guid>${guid}</update_guid>`
        + `<update_guid_history/><update_set display_value=""/><view/></sys_update_xml>`;
    const re = new RegExp(`<sys_update_xml action="INSERT_OR_UPDATE"><action>INSERT_OR_UPDATE</action>(?:(?!</sys_update_xml>)[\\s\\S])*?<name>${name}</name>[\\s\\S]*?</sys_update_xml>`);
    if (re.test(xml)) { xml = xml.replace(re, () => entry); console.log(`  replaced ${type}: ${target}`); }
    else { xml = xml.replace('</unload>', () => entry + '</unload>'); console.log(`  added    ${type}: ${target}`); }
}

xml = xml.split(oldSet).join(newSet).split(oldName).join(newName)
    .replace(/(<sys_remote_update_set[\s\S]*?<description>)[\s\S]*?(<\/description>)/, (m, a, b) => a + DESCRIPTION + b)
    .replace(/unload_date="[^"]*"/, `unload_date="${now}"`);
fs.writeFileSync(dst, xml);
const count = (xml.match(/<sys_update_xml action=/g) || []).length;
console.log(`${path.relative(root, dst)}: ${count} update records, ${fs.statSync(dst).size} bytes`);
