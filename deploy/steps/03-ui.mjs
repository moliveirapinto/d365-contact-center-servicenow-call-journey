import { api, find, upsert, readSrc, log } from '../lib.mjs';
import { CASE_OPEN } from './06-play.mjs';

const CALL = 'u_cc_call';
const CASE = 'sn_customerservice_case';

const PARAM = { [CALL]: 'sysparm_call', [CASE]: 'sysparm_case' };

const CLASSIC_CLICK = (title, param) => `d365ccOpen();
function d365ccOpen() {
    var dialog = new GlideModal('d365cc_recording', false, '95%');
    dialog.setTitle('${title}');
    dialog.setPreference('${param}', g_form.getUniqueValue());
    dialog.render();
}`;

const WORKSPACE_CLICK = (title, param) => `function onClick(g_form) {
    g_modal.showFrame({
        url: '/d365cc_recording.do?${param}=' + encodeURIComponent(g_form.getUniqueValue()),
        title: '${title}',
        size: 'lg'
    });
}`;

// Shown on a Case whenever any call is linked to it (not only the one the IVR stamped on the Case).
const CASE_HAS_CALLS = "(function () { var g = new GlideAggregate('u_cc_call'); g.addQuery('u_case', current.getUniqueValue()); g.addAggregate('COUNT'); g.query(); return g.next() && parseInt(g.getAggregate('COUNT'), 10) > 0; })()";


async function uiAction({ table, name, title, order, condition, workspaceScript }) {
    const param = PARAM[table];
    return upsert('sys_ui_action', `name=${name}^table=${table}`, {
        name, table, action_name: name.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
        active: 'true', client: 'true', form_button: 'true', form_button_v2: 'true',
        format_for_configurable_workspace: 'true', isolate_script: 'true',
        show_insert: 'false', show_update: 'true', order: String(order),
        condition: condition || '',
        onclick: CLASSIC_CLICK(title, param).split('\n')[0],
        script: CLASSIC_CLICK(title, param),
        client_script_v2: workspaceScript || WORKSPACE_CLICK(title, param),
        hint: title
    });
}
// Forms are a sys_ui_form per (table, view) joined to sections by sys_ui_form_section rows.
async function formFor(table, view) {
    const q = `name=${table}` + (view ? `^view=${view.sys_id}` : '^viewISEMPTY');
    let form = await find('sys_ui_form', q);
    if (!form) form = await api('POST', '/api/now/table/sys_ui_form', { name: table, ...(view ? { view: view.sys_id } : {}) });
    return form.sys_id;
}

async function section(table, caption, viewName, elements, position) {
    const view = viewName ? await find('sys_ui_view', `name=${viewName}`) : null;
    const q = `name=${table}^caption=${caption}` + (view ? `^view=${view.sys_id}` : '^viewISEMPTY');
    const id = await upsert('sys_ui_section', q, {
        name: table, caption, title: 'false', header: 'false', ...(view ? { view: view.sys_id } : {})
    });
    let pos = 0;
    for (const el of elements) {
        const isSplit = el.startsWith('.');
        await upsert('sys_ui_element', `sys_ui_section=${id}^element=${el}`, {
            sys_ui_section: id, element: el, position: String(pos++), ...(isSplit ? { type: el } : {})
        });
    }
    const formId = await formFor(table, view);
    await upsert('sys_ui_form_section', `sys_ui_form=${formId}^sys_ui_section=${id}`, {
        sys_ui_form: formId, sys_ui_section: id, position: String(position)
    });
    return id;
}

// Remove a section (and its form links and elements) from every view of a table.
async function removeSection(table, caption) {
    const sections = await api('GET', `/api/now/table/sys_ui_section?sysparm_query=${encodeURIComponent('name=' + table + '^caption=' + caption)}&sysparm_fields=sys_id`);
    for (const sec of sections) {
        for (const tbl of ['sys_ui_form_section', 'sys_ui_element']) {
            const rows = await api('GET', `/api/now/table/${tbl}?sysparm_query=${encodeURIComponent('sys_ui_section=' + sec.sys_id)}&sysparm_fields=sys_id`);
            for (const r of rows) await api('DELETE', `/api/now/table/${tbl}/${r.sys_id}`);
        }
        await api('DELETE', `/api/now/table/sys_ui_section/${sec.sys_id}`);
    }
}
// Move a section to the front of an existing form and push the others down.
async function placeAfterMain(table, viewName, caption) {
    const view = viewName ? await find('sys_ui_view', `name=${viewName}`) : null;
    const formId = await formFor(table, view);
    const rows = await api('GET', `/api/now/table/sys_ui_form_section?sysparm_query=${encodeURIComponent('sys_ui_form=' + formId + '^ORDERBYposition')}&sysparm_fields=sys_id,position,sys_ui_section.caption`);
    const others = rows.filter((r) => r['sys_ui_section.caption'] !== caption);
    const mine = rows.find((r) => r['sys_ui_section.caption'] === caption);
    if (!mine) return;
    const ordered = [others[0], mine, ...others.slice(1)].filter(Boolean);
    let i = 0;
    for (const r of ordered) await api('PATCH', `/api/now/table/sys_ui_form_section/${r.sys_id}`, { position: String(i++) });
}

// "Contact Center Calls" related list on Case and Contact, like Contact_Center_Calls__r in Salesforce.
async function relatedList(table, viewName, relation) {
    const view = viewName ? await find('sys_ui_view', `name=${viewName}`) : null;
    const q = `name=${table}` + (view ? `^view=${view.sys_id}` : '^viewISEMPTY');
    let list = await find('sys_ui_related_list', q);
    if (!list) list = await api('POST', '/api/now/table/sys_ui_related_list', { name: table, ...(view ? { view: view.sys_id } : {}) });
    const entries = await api('GET', `/api/now/table/sys_ui_related_list_entry?sysparm_query=${encodeURIComponent('list_id=' + list.sys_id)}&sysparm_fields=sys_id,related_list,position&sysparm_limit=100`);
    if (entries.some((e) => e.related_list === relation)) return;
    const max = entries.reduce((m, e) => Math.max(m, parseInt(e.position || '0', 10)), 0);
    await api('POST', '/api/now/table/sys_ui_related_list_entry', { list_id: list.sys_id, related_list: relation, position: String(max + 1) });
}
export default async function ui() {
    await upsert('sys_ui_page', 'name=d365cc_recording', {
        name: 'd365cc_recording', description: 'D365 Contact Center recording pop-up (iframe wrapper)',
        html: readSrc('ui-page-recording.xml').replace(/^<\?xml[^>]*\?>\s*/, ''), direct: 'false', category: 'general'
    });
    log('  ui page d365cc_recording ok');

    await uiAction({ table: CALL, name: 'Play recording', title: 'Call recording', order: 100 });
    await uiAction({ table: CALL, name: 'Transcript', title: 'Call transcript', order: 110 });
    await uiAction({
        table: CASE, name: 'Play call recording', title: 'Call recording', order: 400,
        condition: CASE_HAS_CALLS, workspaceScript: CASE_OPEN
    });
    log('  ui actions ok');

    const callLayout = [
        '.begin_split', 'u_title', 'u_status', 'u_case', 'u_contact', 'u_direction', 'u_channel', 'u_caller_phone', 'u_called_number',
        '.split', 'u_call_received', 'u_agent_connected', 'u_call_ended', 'u_queue', 'u_agent', 'u_customer_sentiment', 'u_handled_by_virtual_agent',
        '.end_split', 'u_journey_html'
    ];
    const callDetails = [
        '.begin_split', 'u_total_duration_seconds', 'u_virtual_agent_seconds', 'u_wait_time_seconds',
        '.split', 'u_talk_time_seconds', 'u_handle_time_seconds', 'u_conversation_id', 'u_recording_url', '.end_split'
    ];
    for (const view of [null, 'workspace']) {
        await section(CALL, '', view, callLayout, 0);
        await section(CALL, 'Call details', view, callDetails, 1);
    }
    // Calls appear in the Case Activity stream (see 02-logic), not on the Case form: remove the old section.
    await removeSection(CASE, 'Call Journey');
    await removeSection(CALL, 'Quality evaluation');
    // The inline recording link was replaced by the header buttons; drop it from forms deployed earlier.
    for (const el of await api('GET', `/api/now/table/sys_ui_element?sysparm_query=${encodeURIComponent('element=u_recording^sys_ui_section.name=' + CALL)}&sysparm_fields=sys_id`)) await api('DELETE', `/api/now/table/sys_ui_element/${el.sys_id}`);
    for (const view of [null, 'workspace']) {
        await relatedList(CASE, view, 'u_cc_call.u_case');
        await relatedList('customer_contact', view, 'u_cc_call.u_contact');
    }
    log('  form layouts + related lists ok');
}
