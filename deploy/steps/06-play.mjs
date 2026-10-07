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
    type: 'D365CCPlay'
});`;

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
            size: 'lg',
            height: 900
        }); };
        setTimeout(open, 2500);
    });
}`;

const OPEN_JOURNEY = `function onClick(g_form) {
    var ga = new GlideAjax('D365CCPlay');
    ga.addParam('sysparm_name', 'latestCall');
    ga.addParam('sysparm_case', g_form.getUniqueValue());
    ga.getXMLAnswer(function (callId) {
        if (callId) g_aw.openRecord('u_cc_call', callId);
        else g_form.addInfoMessage('This case has no calls yet.');
    });
}`;

export default async function play() {
    await upsert('sys_ui_action', 'name=Open call journey^table=sn_customerservice_case', {
        name: 'Open call journey', table: 'sn_customerservice_case', action_name: 'open_call_journey', active: 'true',
        client: 'true', form_button: 'true', form_button_v2: 'true', format_for_configurable_workspace: 'true',
        isolate_script: 'true', show_insert: 'false', show_update: 'true', order: '390', onclick: '', script: '',
        client_script_v2: OPEN_JOURNEY, hint: 'Open the call journey in a sub tab'
    });
    await upsert('sys_script_include', 'name=D365CCPlay', {
        name: 'D365CCPlay', api_name: 'global.D365CCPlay', script: AJAX, active: 'true', access: 'public',
        client_callable: 'true', description: 'One-time hand-off that lets journey-card buttons open the recording modal.'
    });
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
