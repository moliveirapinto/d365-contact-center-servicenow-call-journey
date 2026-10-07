import { upsert, find, api, log } from '../lib.mjs';

// Links inside the Activity stream always open in a new browser tab, and that cannot be changed. So the link opens this
// tiny page, which asks the Workspace tab that is already open (BroadcastChannel) to open the call as a sub tab and
// then closes itself. If no Workspace tab answers, it simply goes to the record.
const PAGE = `<?xml version="1.0" encoding="utf-8" ?>
<j:jelly trim="false" xmlns:j="jelly:core" xmlns:g="glide" xmlns:j2="null" xmlns:g2="null">
<g:evaluate var="jvar_id" jelly="true"><![CDATA[
    var id = String(RP.getParameterValue('sysparm_call') || '');
    /^[0-9a-f]{32}$/.test(id) ? id : '';
]]></g:evaluate>
<g:evaluate var="jvar_case" jelly="true"><![CDATA[
    var cs = '';
    var cid = String(RP.getParameterValue('sysparm_call') || '');
    if (/^[0-9a-f]{32}$/.test(cid)) { var g = new GlideRecord('u_cc_call'); if (g.get(cid)) cs = String(g.getValue('u_case') || ''); }
    cs;
]]></g:evaluate>
<div id="msg" style="font-family:'Source Sans Pro',Helvetica,Arial,sans-serif;font-size:14px;color:#424242;padding:24px;">Opening call journey...</div>
<div id="callid" data-id="\${jvar_id}" data-case="\${jvar_case}" style="display:none"></div>
<script>
(function () {
    var id = document.getElementById('callid').getAttribute('data-id');
    if (!id) { return; }
    var done = false;
    var bc = new BroadcastChannel('d365cc_open');
    bc.onmessage = function (e) {
        if (e.data) { if (e.data.ack === id) { done = true; window.close(); document.getElementById('msg').textContent = 'Opened. You can close this tab.'; } }
    };
    bc.postMessage({ call: id, case: document.getElementById('callid').getAttribute('data-case') || '', msg: String(Date.now()) });
    setTimeout(function () {
        if (!done) { location.replace('/now/cwf/agent/record/u_cc_call/' + id); }
    }, 1800);
})();
</script>
</j:jelly>`;

const LISTENER = `function onLoad() {
    var me = '';
    try { me = sessionStorage.getItem('d365cc_win') || ''; if (!me) { me = String(Math.random()); sessionStorage.setItem('d365cc_win', me); } } catch (e) { me = String(Math.random()); }
    var mark = function () { try { localStorage.setItem('d365cc_active', me); } catch (e) { } };
    mark();
    try { window.addEventListener('mousedown', mark, true); window.addEventListener('focus', mark); } catch (e) { }
    var seen = '';
    var bc = new BroadcastChannel('d365cc_open');
    bc.onmessage = function (e) {
        var d = e.data;
        if (!d) return;
        if (!d.call) return;
        var active = '';
        try { active = localStorage.getItem('d365cc_active') || ''; } catch (x) { }
        // Answer when this is the last-used window, or when it already shows the call's own Case.
        var mine = false;
        try { mine = !!d.case && (g_form.getUniqueValue() === d.case || g_form.getValue('u_case') === d.case); } catch (x) { }
        if (active !== me && !mine) return;
        var last = '';
        try { last = sessionStorage.getItem('d365cc_handled') || ''; } catch (x) { last = seen; }
        if (last === d.msg) return;
        try { sessionStorage.setItem('d365cc_handled', d.msg); } catch (x) { seen = d.msg; }
        g_aw.openRecord('u_cc_call', d.call);
        bc.postMessage({ ack: d.call });
    };
}`;
export default async function open() {
    await upsert('sys_ui_page', 'name=d365cc_open', { name: 'd365cc_open', html: PAGE.replace(/^<\?xml[^>]*\?>\s*/, ''), direct: 'false', category: 'general' });
    for (const table of ['u_cc_call', 'sn_customerservice_case']) {
        await upsert('sys_script_client', `name=D365CC open call sub tab^table=${table}`, {
            name: 'D365CC open call sub tab', table, type: 'onLoad', active: 'true', global: 'true', ui_type: '10', script: LISTENER
        });
    }
    const probe = await find('sys_script_client', 'name=D365CC probe2');
    if (probe) await api('DELETE', `/api/now/table/sys_script_client/${probe.sys_id}`);
    log('  open-call hand-off ready');
}
