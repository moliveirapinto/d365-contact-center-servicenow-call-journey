// Builds a release update set from a CLEAN instance: it records everything deploy.mjs creates in a new update set and
// writes it as a "Retrieved Update Set" XML file that users can import.
//   1. node deploy/tools/teardown.mjs --yes          (start from a clean instance)
//   2. D365_MODE=itsm node deploy/tools/capture-update-set.mjs 1.1.0
// The mode comes from D365_MODE (csm by default) and ends up in the file name:
//   servicenow/package/D365_ContactCenter_CallJourney_ServiceNow_UpdateSet_<version>_<CSM|ITSM>.xml
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cfg, api, find, log, MODE } from '../lib.mjs';

const version = process.argv[2];
if (!version) { console.error('Usage: node deploy/tools/capture-update-set.mjs <version>'); process.exit(1); }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const label = MODE.name.toUpperCase();
const outFile = path.join(root, 'servicenow', 'package', `D365_ContactCenter_CallJourney_ServiceNow_UpdateSet_${version}_${label}.xml`);

const hex = () => crypto.randomBytes(16).toString('hex');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

const DESCRIPTION = MODE.name === 'itsm'
    ? 'Dynamics 365 Contact Center call journey for ServiceNow ITSM (Incidents and ServiceNow users as callers; no CSM needed): '
    : 'Dynamics 365 Contact Center call journey for ServiceNow CSM (Cases and customer contacts): ';
const DESCRIPTION_TAIL = 'Contact Center Call table and fields, call journey card, record button and call picker, recording &amp; transcript '
    + 'pop-up, activity entry, form layouts, related lists, the REST API for the D365 flows, and the softphone: the Dynamics 365 Contact Center '
    + 'Edge desktop in OpenFrame through the page /d365cc_edge.do. After committing, set the d365cc.* system properties, give agents the role '
    + 'sn_openframe_user, open /cache.do once and hard-refresh the agent interface.';

// Values the user must set again after importing; the real ones from this instance are never shipped.
const PLACEHOLDERS = {
    'd365cc.org_url': 'https://YOURORG.crm.dynamics.com',
    'd365cc.app_id': 'REPLACE-WITH-YOUR-D365-APP-ID',
    'd365cc.time_zone': 'America/New_York',
    'd365cc.time_zone_label': 'ET'
};

const admin = await find('sys_user', `user_name=${cfg.user}`);
const setStart = new Date().toISOString().replace('T', ' ').slice(0, 19);
if (!admin) throw new Error(`user ${cfg.user} not found`);

// 1. A new update set that the Table API changes will be recorded in.
const setName = `D365 Contact Center - Call Journey ${version} (${label})`;
// --reuse <sys_id> builds the file from an update set captured earlier instead of running deploy again.
const reuseArg = process.argv.indexOf('--reuse');
const reuseId = reuseArg > 0 ? process.argv[reuseArg + 1] : '';
const set = reuseId ? { sys_id: reuseId } : await api('POST', '/api/now/table/sys_update_set', {
    name: setName, description: 'Captured from deploy.mjs', state: 'in progress', application: 'global'
});
const pref = await find('sys_user_preference', `user=${admin.sys_id}^name=sys_update_set`, 'sys_id,value');
const previousSet = pref ? pref.value : null;
if (reuseId) { /* nothing to switch */ } else if (pref) await api('PATCH', `/api/now/table/sys_user_preference/${pref.sys_id}`, { value: set.sys_id });
else await api('POST', '/api/now/table/sys_user_preference', { user: admin.sys_id, name: 'sys_update_set', value: set.sys_id, type: 'string' });
log(`update set ${set.sys_id} is now the current update set for ${cfg.user}`);

// 2. Install everything into it (all steps, in mode D365_MODE).
if (!reuseId) {
    const run = spawnSync(process.execPath, [path.join(root, 'deploy', 'deploy.mjs')], { stdio: 'inherit', env: process.env });
    if (run.status !== 0) throw new Error('deploy.mjs failed; nothing was exported.');
}

// 3. Read back what was recorded.
let rows = await api('GET', `/api/now/table/sys_update_xml?sysparm_query=${encodeURIComponent('update_set=' + set.sys_id)}&sysparm_limit=2000&sysparm_exclude_reference_link=true`);
log(`${rows.length} update records captured`);
if (!rows.length) throw new Error('No updates were captured. Check that the update set is the current one for the user.');

// Adding columns to Incident/Case makes ServiceNow record that table's whole form layout too. Never ship those:
// they would overwrite the customer's own form. Only the Contact Center Call sections belong in the package.
const before = rows.length;
rows = rows.filter((r) => !(/^sys_ui_section_/.test(r.name) && !String(r.payload).includes('table="u_cc_call"')));
if (rows.length !== before) log(`  dropped ${before - rows.length} form layout update(s) of other tables`);

// The Table API does not record forms, form sections, related lists or the OpenFrame configuration. Export them
// from the instance (the ?UNL unload) and add them as updates.
const auth = 'Basic ' + Buffer.from(`${cfg.user}:${cfg.pass}`).toString('base64');
async function unload(table, sysId) {
    const res = await fetch(`https://${cfg.instance}/${table}.do?UNL&sysparm_query=sys_id=${sysId}`, { headers: { Authorization: auth } });
    if (!res.ok) throw new Error(`export ${table} ${sysId}: HTTP ${res.status}`);
    const m = (await res.text()).match(new RegExp(`<${table} action="INSERT_OR_UPDATE">[\\s\\S]*?</${table}>`));
    if (!m) throw new Error(`export ${table} ${sysId}: not found`);
    return m[0];
}
const extra = [];
async function add(table, query, type, target) {
    const list = await api('GET', `/api/now/table/${table}?sysparm_query=${encodeURIComponent(query)}&sysparm_fields=sys_id&sysparm_limit=500`);
    for (const r of list) extra.push({ table, sys_id: r.sys_id, type, target });
}
await add('sys_ui_form', 'name=u_cc_call', 'Form', 'Contact Center Call');
await add('sys_ui_section', 'name=u_cc_call', 'Form Section', 'Contact Center Call');
await add('sys_ui_element', 'sys_ui_section.name=u_cc_call', 'Form Element', 'Contact Center Call element');
await add('sys_ui_form_section', 'sys_ui_form.name=u_cc_call', 'Form Layout', 'Contact Center Call layout');
const entries = await api('GET', `/api/now/table/sys_ui_related_list_entry?sysparm_query=${encodeURIComponent('related_listSTARTSWITHu_cc_call')}&sysparm_fields=sys_id,list_id&sysparm_exclude_reference_link=true`);
for (const e of entries) extra.push({ table: 'sys_ui_related_list_entry', sys_id: e.sys_id, type: 'Related Lists', target: 'Contact Center Calls related list' });
// Lists this install created itself (the CSM edition creates them; the ITSM edition only adds entries to existing ones).
const listIds = [...new Set(entries.map((e) => e.list_id))];
if (listIds.length) await add('sys_ui_related_list', `sys_created_on>=${setStart}^sys_idIN${listIds.join(',')}`, 'Related Lists', 'Contact Center Calls related list');
await add('sn_openframe_configuration', 'name=Dynamics 365 Contact Center', 'OpenFrame Configuration', 'Dynamics 365 Contact Center');
log(`${extra.length} records exported from the instance`);


const remoteId = hex();

function entry(name, payload, type, target, category = 'customer', action = 'INSERT_OR_UPDATE') {
    return `<sys_update_xml action="INSERT_OR_UPDATE"><action>${esc(action)}</action><application display_value="Global">global</application>`
        + `<category>${esc(category)}</category><comments/><name>${esc(name)}</name><payload>${esc(payload)}</payload><payload_hash/>`
        + `<remote_update_set display_value="${esc(setName)}">${remoteId}</remote_update_set><replace_on_upgrade>false</replace_on_upgrade>`
        + `<sys_created_by>admin</sys_created_by><sys_created_on>${now}</sys_created_on><sys_id>${hex()}</sys_id><sys_mod_count>0</sys_mod_count>`
        + `<sys_recorded_at>${now}</sys_recorded_at><sys_updated_by>admin</sys_updated_by><sys_updated_on>${now}</sys_updated_on>`
        + `<target_name>${esc(target)}</target_name><type>${esc(type)}</type><update_domain>global</update_domain><update_guid>${hex()}</update_guid>`
        + `<update_guid_history/><update_set display_value=""/><view/></sys_update_xml>`;
}
const items = []; // { name, xml }
for (const r of rows) {
    // With --base the form layout, related list and OpenFrame records of the previous release stay as they are.
    if (process.argv.includes('--base') && /^sys_ui_(form|section|element|related)/.test(r.name)) continue;
    let payload = r.payload || '';
    if (r.type === 'System Property' || /^sys_properties_/.test(r.name)) {
        const pm = payload.match(/<name>(d365cc\.[a-z_]+)<\/name>/);
        const ph = pm && PLACEHOLDERS[pm[1]];
        if (ph !== undefined) payload = payload.replace(/<value>[^<]*<\/value>|<value\/>/, `<value>${ph}</value>`);
    }
    items.push({ name: r.name, xml: entry(r.name, payload, r.type, r.target_name, r.category || 'customer', r.action || 'INSERT_OR_UPDATE') });
}
// With --base the UI records (forms, sections, related lists, OpenFrame) of the previous release are kept as they are:
// they are matched by their own sys_id and did not change.
for (const x of (process.argv.includes('--base') ? [] : extra)) {
    const name = `${x.table}_${x.sys_id}`;
    const payload = `<?xml version="1.0" encoding="UTF-8"?><record_update table="${x.table}">${await unload(x.table, x.sys_id)}</record_update>`;
    items.push({ name, xml: entry(name, payload, x.type, x.target) });
}

// Upgrades: records are matched by sys_id when an update set is committed, so a new release must reuse the ids of the
// previous one. Capture on an instance that already has the previous release installed (deploy.mjs then updates the
// records in place), and merge the result over the previous update set (--base): same name = replaced, new = added.
const baseArg = process.argv.indexOf('--base');
const parts = [];
if (baseArg > 0) {
    const baseXml = fs.readFileSync(path.resolve(process.argv[baseArg + 1]), 'utf8');
    const oldSet = baseXml.match(/<sys_remote_update_set[\s\S]*?<sys_id>([0-9a-f]{32})<\/sys_id>/)[1];
    const oldName = baseXml.match(/<sys_remote_update_set[\s\S]*?<name>([^<]+)<\/name>/)[1];
    const fresh = new Set(items.map((i) => esc(i.name)));
    let kept = 0;
    for (const m of baseXml.match(/<sys_update_xml action="INSERT_OR_UPDATE">[\s\S]*?<\/sys_update_xml>/g) || []) {
        const n = (m.match(/<name>([^<]*)<\/name>/) || [])[1];
        if (fresh.has(n)) continue;
        // Carried-over records get the new build time: a customer's own install of the previous release is newer than the
        // old time stamps, and ServiceNow would report each one as "a local update that is newer" when previewing.
        // Only the outer entry is touched (after the payload), never the record inside the payload.
        const cut = m.indexOf('</payload>');
        const restamped = m.slice(0, cut) + m.slice(cut).replace(/<(sys_updated_on|sys_recorded_at|sys_created_on)>[^<]*<\/\1>/g, '<$1>' + now + '</$1>');
        parts.push(restamped.split(oldSet).join(remoteId).split(esc(oldName)).join(esc(setName)));
        kept++;
    }
    log(`  ${kept} unchanged records kept from the base update set`);
}
for (const i of items) parts.push(i.xml);
const total = parts.length;

const header = `<?xml version="1.0" encoding="UTF-8"?><unload unload_date="${now}"><sys_remote_update_set action="INSERT_OR_UPDATE"><application display_value="Global">global</application>`
    + `<description>${DESCRIPTION}${DESCRIPTION_TAIL}</description><name>${esc(setName)}</name><origin_sys_id/><parent display_value=""/><release_date/>`
    + `<remote_base_update_set display_value=""/><remote_parent_id/><remote_sys_id>${remoteId}</remote_sys_id><state>loaded</state><summary/>`
    + `<sys_class_name>sys_remote_update_set</sys_class_name><sys_created_by>admin</sys_created_by><sys_created_on>${now}</sys_created_on><sys_id>${remoteId}</sys_id>`
    + `<sys_mod_count>0</sys_mod_count><sys_updated_by>admin</sys_updated_by><sys_updated_on>${now}</sys_updated_on></sys_remote_update_set>`;
fs.writeFileSync(outFile, header + parts.join('') + '</unload>');
log(`${path.relative(root, outFile)}: ${total} update records, ${fs.statSync(outFile).size} bytes`);

await api('PATCH', `/api/now/table/sys_update_set/${set.sys_id}`, { state: 'complete' });
if (pref && previousSet) await api('PATCH', `/api/now/table/sys_user_preference/${pref.sys_id}`, { value: previousSet });
else if (pref) await api('DELETE', `/api/now/table/sys_user_preference/${pref.sys_id}`);
