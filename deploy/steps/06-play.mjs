import { upsert, find, log } from '../lib.mjs';

// The Activity/journey card is an HTML field, which cannot run scripts, so its buttons cannot open a modal
// directly. Instead a button opens this small page, which stores a one-time request for the signed-in user and
// jumps to the record; an onLoad client script on the record then opens the recording modal (g_modal).
const AJAX = `var D365CCPlay = Class.create();
D365CCPlay.prototype = Object.extendsObject(global.AbstractAjaxProcessor, {
    take: function () {
        var pr = new GlideRecord('sys_user_preference');
        pr.addQuery('user', gs.getUserID());
        pr.addQuery('name', 'd365cc.play');
        pr.query();
        if (!pr.next()) return '';
        var raw = pr.getValue('value') || '';
        pr.deleteRecord();
        if (!raw) return '';
        var p = raw.split('|');
        if (p.length !== 3 || (new GlideDateTime().getNumericValue() - parseInt(p[2], 10)) > 120000) return '';
        return p[0] + '|' + p[1];
    },
    latestCall: function () {
        var gr = new GlideRecord('u_cc_call');
        gr.addQuery('u_case', this.getParameter('sysparm_case'));
        gr.orderByDesc('u_call_received');
        gr.setLimit(1);
        gr.query();
        return gr.next() ? gr.getUniqueValue() : '';
    },
    calls: function () {
        var gr = new GlideAggregate('u_cc_call');
        gr.addQuery('u_case', this.getParameter('sysparm_case'));
        gr.addAggregate('COUNT');
        gr.query();
        var n = gr.next() ? parseInt(gr.getAggregate('COUNT'), 10) : 0;
        return n + '|' + this.latestCall();
    },
    type: 'D365CCPlay'
});`;

// Lists every call on a Case. Picking one asks the Workspace window (BroadcastChannel, see 07-open) to open it as a
// sub tab, then closes this pop-up.
const PICKER = `<?xml version="1.0" encoding="utf-8" ?>
<j:jelly trim="false" xmlns:j="jelly:core" xmlns:g="glide" xmlns:j2="null" xmlns:g2="null">
<g:evaluate var="jvar_calls" jelly="true"><![CDATA[
    var caseId = String(RP.getParameterValue('sysparm_case') || '');
    var list = [];
    if (/^[0-9a-f]{32}$/.test(caseId)) {
        var j = new D365CCJourney();
        var gr = new GlideRecord('u_cc_call');
        gr.addQuery('u_case', caseId);
        gr.orderByDesc('u_call_received');
        gr.setLimit(50);
        gr.query();
        while (gr.next()) {
            list.push({ id: gr.getUniqueValue(), when: gr.getDisplayValue('u_call_received'), agent: gr.getValue('u_agent') || '',
                dur: j.secs(gr.getValue('u_total_duration_seconds')) || '', status: gr.getDisplayValue('u_status') || '', dir: gr.getDisplayValue('u_direction') || '' });
        }
    }
    JSON.stringify(list);
]]></g:evaluate>
<style>
    html, body { margin: 0; overflow-x: hidden; font-family: "Source Sans Pro", Helvetica, Arial, sans-serif; color: #242424; }
    .btn-response-time { display: none !important; }
    .hint { padding: 12px 16px; font-size: 13px; color: #5f6b7a; }
    .row { display: flex; align-items: center; gap: 16px; padding: 12px 16px; border-top: 1px solid #e6e9ef; cursor: pointer; }
    .row:hover { background: #eef4fc; }
    .when { font-size: 14px; font-weight: 600; min-width: 190px; }
    .meta { font-size: 13px; color: #5f6b7a; flex: 1; }
    .pill { font-size: 12px; font-weight: 600; padding: 2px 10px; border-radius: 10px; background: #e5f3e5; color: #107c10; }
</style>
<div class="hint">This case has several calls. Pick one to open it.</div>
<div id="list" data-calls="\${HTML:jvar_calls}"></div>
<script>
(function () {
    var calls = JSON.parse(document.getElementById('list').getAttribute('data-calls') || '[]');
    var caseId = (location.search.match(/sysparm_case=([0-9a-f]{32})/) || [])[1] || '';
    var bc = new BroadcastChannel('d365cc_open');
    function closeModal() {
        try {
            var n = window.frameElement;
            while (n) {
                var root = n.getRootNode ? n.getRootNode() : null;
                var b = root && root.querySelector ? root.querySelector('[aria-label="Close dialog"], button[title="Close dialog"]') : null;
                if (b) { b.click(); return; }
                n = n.assignedSlot || (n.parentNode ? n.parentNode.host : null) || n.parentElement;
            }
        } catch (e) { }
    }
    bc.onmessage = function (e) { if (e.data && e.data.ack) closeModal(); };
    calls.forEach(function (c) {
        var d = document.createElement('div');
        d.className = 'row';
        d.innerHTML = '<div class="when"></div><div class="meta"></div><div class="pill"></div>';
        d.children[0].textContent = c.when;
        d.children[1].textContent = [c.dir, c.agent, c.dur].filter(Boolean).join('  |  ');
        d.children[2].textContent = c.status;
        d.onclick = function () { bc.postMessage({ call: c.id, case: caseId, msg: String(Date.now()) }); };
        document.getElementById('list').appendChild(d);
    });
})();
</script>
</j:jelly>`;

// Shared by the case "Open call journey" and "Play call recording" actions.
export const CASE_OPEN = `function onClick(g_form) {
    var id = g_form.getUniqueValue();
    var ga = new GlideAjax('D365CCPlay');
    ga.addParam('sysparm_name', 'calls');
    ga.addParam('sysparm_case', id);
    ga.getXMLAnswer(function (answer) {
        var p = (answer || '0|').split('|');
        var n = parseInt(p[0], 10) || 0;
        if (n === 0) g_form.addInfoMessage('This case has no calls yet.');
        else if (n === 1) g_aw.openRecord('u_cc_call', p[1]);
        else g_modal.showFrame({ url: '/d365cc_calls.do?sysparm_case=' + id, title: 'Calls on this case', size: 'lg', height: 420 });
    });
}`;

const PAGE = `<?xml version="1.0" encoding="utf-8" ?>
<j:jelly trim="false" xmlns:j="jelly:core" xmlns:g="glide" xmlns:j2="null" xmlns:g2="null">
<g:evaluate var="jvar_dest" jelly="true"><![CDATA[
    var dest = '/now/cwf/agent/home';
    var callId = String(RP.getParameterValue('sysparm_call') || '');
    var caseId = String(RP.getParameterValue('sysparm_case') || '');
    var ok = /^[0-9a-f]{32}$/;
    var fromCase = String(RP.getParameterValue('sysparm_from') || '');
    var param = '', id = '', table = '';
    if (ok.test(callId)) { param = 'sysparm_call'; id = callId; table = 'u_cc_call'; }
    else if (ok.test(caseId)) { param = 'sysparm_case'; id = caseId; table = 'sn_customerservice_case'; }
    if (id) {
        var pr = new GlideRecord('sys_user_preference');
        pr.addQuery('user', gs.getUserID());
        pr.addQuery('name', 'd365cc.play');
        pr.query();
        if (!pr.next()) { pr.initialize(); pr.setValue('user', gs.getUserID()); pr.setValue('name', 'd365cc.play'); pr.setValue('type', 'string'); }
        pr.setValue('value', param + '|' + id + '|' + new GlideDateTime().getNumericValue());
        if (pr.isNewRecord()) pr.insert(); else pr.update();
        dest = '/now/cwf/agent/record/' + table + '/' + id;
        if (param === 'sysparm_call' && ok.test(fromCase)) dest = '/now/cwf/agent/record/sn_customerservice_case/' + fromCase;
    }
    dest;
]]></g:evaluate>
<script>location.replace('\${jvar_dest}');</script>
</j:jelly>`;

const CLIENT = `function onLoad() {
    var ga = new GlideAjax('D365CCPlay');
    ga.addParam('sysparm_name', 'take');
    ga.getXMLAnswer(function (answer) {
        if (!answer || answer.indexOf('|') < 0) return;
        var p = answer.split('|');
        var open = function () { g_modal.showFrame({
            url: '/d365cc_recording.do?' + p[0] + '=' + encodeURIComponent(p[1]),
            title: p[0] === 'sysparm_case' ? 'Call recordings' : 'Call recording',
            size: 'lg'
        }); };
        setTimeout(open, 2500);
    });
}`;


export default async function play() {
    await upsert('sys_ui_action', 'name=Open call journey^table=sn_customerservice_case', {
        name: 'Open call journey', table: 'sn_customerservice_case', action_name: 'open_call_journey', active: 'true',
        client: 'true', form_button: 'true', form_button_v2: 'true', format_for_configurable_workspace: 'true',
        isolate_script: 'true', show_insert: 'false', show_update: 'true', order: '390', onclick: '', script: '',
        client_script_v2: CASE_OPEN, hint: 'Open the call journey in a sub tab'
    });
    await upsert('sys_script_include', 'name=D365CCPlay', {
        name: 'D365CCPlay', api_name: 'global.D365CCPlay', script: AJAX, active: 'true', access: 'public',
        client_callable: 'true', description: 'One-time hand-off that lets journey-card buttons open the recording modal.'
    });
    await upsert('sys_ui_page', 'name=d365cc_calls', { name: 'd365cc_calls', html: PICKER.replace(/^<\?xml[^>]*\?>\s*/, ''), direct: 'false', category: 'general' });
    await upsert('sys_ui_page', 'name=d365cc_play', { name: 'd365cc_play', html: PAGE.replace(/^<\?xml[^>]*\?>\s*/, ''), direct: 'false', category: 'general' });
    for (const table of ['u_cc_call', 'sn_customerservice_case']) {
        await upsert('sys_script_client', `name=D365CC open recording^table=${table}`, {
            name: 'D365CC open recording', table, type: 'onLoad', active: 'true', global: 'true', ui_type: '10', script: CLIENT
        });
    }
    const probe = await find('sys_script_client', 'name=D365CC probe');
    if (probe) { const { api } = await import('../lib.mjs'); await api('DELETE', `/api/now/table/sys_script_client/${probe.sys_id}`); }
    log('  play hand-off ready');
}
