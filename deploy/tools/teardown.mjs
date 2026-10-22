// Removes everything this package installed from the instance in .env.local (used to switch an instance between
// the csm and itsm variants, or to uninstall). It deletes the Contact Center Call table and ALL its data.
// Usage: node deploy/tools/teardown.mjs --yes
import { api, find, log, cfg } from '../lib.mjs';

if (!process.argv.includes('--yes')) {
    console.error(`This deletes the Contact Center Call table and every D365CC record on ${cfg.instance}. Run again with --yes.`);
    process.exit(1);
}

const enc = encodeURIComponent;

async function remove(table, query, label) {
    const rows = await api('GET', `/api/now/table/${table}?sysparm_query=${enc(query)}&sysparm_fields=sys_id&sysparm_limit=500`);
    let n = 0;
    for (const r of rows) {
        try { await api('DELETE', `/api/now/table/${table}/${r.sys_id}`); n++; } catch (e) { log(`  ! ${table} ${r.sys_id}: ${e.message}`); }
    }
    if (n) log(`  ${label || table}: ${n} removed`);
}

const CASE_TABLES = ['sn_customerservice_case', 'incident'];
const CASE_COLUMNS = 'u_d365_conversation_id,u_d365_call_recording,u_d365_recording_url,u_call_journey';

// UI configuration that points at the call table or at the columns on the case table.
const sections = await api('GET', `/api/now/table/sys_ui_section?sysparm_query=${enc('name=u_cc_call')}&sysparm_fields=sys_id`);
for (const s of sections) {
    await remove('sys_ui_form_section', `sys_ui_section=${s.sys_id}`, 'form sections links');
    await remove('sys_ui_element', `sys_ui_section=${s.sys_id}`, 'form elements');
}
await remove('sys_ui_section', 'name=u_cc_call', 'form sections');
await remove('sys_ui_form', 'name=u_cc_call', 'forms');
await remove('sys_ui_related_list_entry', 'related_listSTARTSWITHu_cc_call', 'related list entries');
// Related lists the CSM edition created for itself (no view, now empty). Lists of the platform are never touched.
for (const tbl of ['sn_customerservice_case', 'customer_contact', 'incident', 'sys_user']) {
    const lists = await api('GET', `/api/now/table/sys_ui_related_list?sysparm_query=${enc('name=' + tbl + '^viewISEMPTY')}&sysparm_fields=sys_id`);
    for (const l of lists) {
        const left = await api('GET', `/api/now/table/sys_ui_related_list_entry?sysparm_query=${enc('list_id=' + l.sys_id)}&sysparm_fields=sys_id&sysparm_limit=1`);
        if (!left.length) { await api('DELETE', `/api/now/table/sys_ui_related_list/${l.sys_id}`); log(`  empty related list of ${tbl} removed`); }
    }
}

await remove('sys_ui_action', 'name=Open call journey^ORname=Recording & transcript^ORname=Play recording^ORname=Transcript^ORname=Play call recording', 'ui actions');
await remove('sys_script_client', 'nameSTARTSWITHD365CC', 'client scripts');
await remove('sys_script', 'nameSTARTSWITHD365CC', 'business rules');
await remove('sys_ui_page', 'nameSTARTSWITHd365cc_', 'ui pages');
await remove('sys_ui_script', 'name=d365cc_edge_host', 'ui script');
await remove('sys_script_include', 'nameSTARTSWITHD365CC', 'script includes');

const svc = await find('sys_ws_definition', 'name=D365 Contact Center');
if (svc) {
    await remove('sys_ws_operation', `web_service_definition=${svc.sys_id}`, 'rest operations');
    await api('DELETE', `/api/now/table/sys_ws_definition/${svc.sys_id}`);
    log('  rest service removed');
}
await remove('sn_openframe_configuration', 'name=Dynamics 365 Contact Center', 'openframe configuration');
await remove('sys_script_fix', 'name=D365CC - Post-install configuration', 'fix script');
await remove('sys_properties', 'nameSTARTSWITHd365cc.', 'properties');

for (const t of CASE_TABLES) {
    await remove('sys_dictionary', `name=${t}^elementIN${CASE_COLUMNS}`, `${t} columns`);
    await remove('sys_documentation', `name=${t}^elementIN${CASE_COLUMNS}`, `${t} labels`);
}

await remove('sys_security_acl', 'nameSTARTSWITHu_cc_call', 'access controls');
const tbl = await find('sys_db_object', 'name=u_cc_call');
if (tbl) {
    await api('DELETE', `/api/now/table/sys_db_object/${tbl.sys_id}`);
    log('  table u_cc_call removed');
}
log('Done. The instance is clean.');
