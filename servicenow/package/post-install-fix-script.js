/*
 * D365CC - Post-install configuration  (Fix Script, safe to run any number of times)
 *
 * The update set carries the table, scripts, business rules, UI Page/Actions, REST API and system properties.
 * This script adds what update sets do not carry reliably:
 *   1. checks the d365cc.* system properties are filled in
 *   2. makes sure the Contact Center Call form layouts exist (Call Journey card on top)
 *   3. adds the "Contact Center Calls" related lists to Case and Customer Contact
 *   4. creates the Dynamics 365 Contact Center softphone (OpenFrame) and lets you use it
 */
(function () {
    var out = function (m) { gs.print('[D365CC] ' + m); };
    var CALL = 'u_cc_call', CASE = 'sn_customerservice_case';

    // 1. Settings
    var org = gs.getProperty('d365cc.org_url', '');
    var ready = org && org.indexOf('YOURORG') < 0;
    if (!ready) out('ACTION NEEDED: set system property d365cc.org_url to your Dynamics 365 URL (and d365cc.app_id), then run this script again to create the softphone.');

    // 2. Form layouts: [caption, elements]. The first section has no caption.
    var sections = [
        ['', ['u_journey_html', '.begin_split', 'u_title', 'u_status', 'u_case', 'u_contact', 'u_direction', 'u_channel', 'u_caller_phone', 'u_called_number',
              '.split', 'u_call_received', 'u_agent_connected', 'u_call_ended', 'u_queue', 'u_agent', 'u_customer_sentiment', 'u_handled_by_virtual_agent', '.end_split']],
        ['Call details', ['.begin_split', 'u_total_duration_seconds', 'u_virtual_agent_seconds', 'u_wait_time_seconds',
              '.split', 'u_talk_time_seconds', 'u_handle_time_seconds', 'u_conversation_id', 'u_recording_url', '.end_split']]
    ];
    var views = ['', 'workspace'];
    for (var v = 0; v < views.length; v++) {
        var viewId = '';
        if (views[v]) { var vw = new GlideRecord('sys_ui_view'); if (!vw.get('name', views[v])) continue; viewId = vw.getUniqueValue(); }
        var form = new GlideRecord('sys_ui_form');
        form.addQuery('name', CALL);
        if (viewId) form.addQuery('view', viewId); else form.addEncodedQuery('viewISEMPTY');
        form.query();
        if (!form.next()) { form.initialize(); form.setValue('name', CALL); if (viewId) form.setValue('view', viewId); form.insert(); }
        for (var s = 0; s < sections.length; s++) {
            var sec = new GlideRecord('sys_ui_section');
            sec.addQuery('name', CALL);
            if (sections[s][0]) sec.addQuery('caption', sections[s][0]); else sec.addEncodedQuery('captionISEMPTY');
            if (viewId) sec.addQuery('view', viewId); else sec.addEncodedQuery('viewISEMPTY');
            sec.query();
            if (!sec.next()) { sec.initialize(); sec.setValue('name', CALL); if (sections[s][0]) sec.setValue('caption', sections[s][0]); if (viewId) sec.setValue('view', viewId); sec.insert(); }
            var secId = sec.getUniqueValue();
            var els = sections[s][1];
            for (var e = 0; e < els.length; e++) {
                var el = new GlideRecord('sys_ui_element');
                el.addQuery('sys_ui_section', secId); el.addQuery('element', els[e]); el.query();
                if (!el.next()) { el.initialize(); el.setValue('sys_ui_section', secId); el.setValue('element', els[e]); if (els[e].charAt(0) === '.') el.setValue('type', els[e]); }
                el.setValue('position', e);
                if (el.isNewRecord()) el.insert(); else el.update();
            }
            var fs = new GlideRecord('sys_ui_form_section');
            fs.addQuery('sys_ui_form', form.getUniqueValue()); fs.addQuery('sys_ui_section', secId); fs.query();
            if (!fs.next()) { fs.initialize(); fs.setValue('sys_ui_form', form.getUniqueValue()); fs.setValue('sys_ui_section', secId); }
            fs.setValue('position', s);
            if (fs.isNewRecord()) fs.insert(); else fs.update();
        }
    }
    out('Contact Center Call form layouts are in place.');

    // 3. Related lists (classic UI)
    var lists = [[CASE, 'u_cc_call.u_case'], ['customer_contact', 'u_cc_call.u_contact']];
    for (var l = 0; l < lists.length; l++) {
        for (var w = 0; w < views.length; w++) {
            var vid = '';
            if (views[w]) { var vv = new GlideRecord('sys_ui_view'); if (!vv.get('name', views[w])) continue; vid = vv.getUniqueValue(); }
            var rl = new GlideRecord('sys_ui_related_list');
            rl.addQuery('name', lists[l][0]);
            if (vid) rl.addQuery('view', vid); else rl.addEncodedQuery('viewISEMPTY');
            rl.query();
            if (!rl.next()) { rl.initialize(); rl.setValue('name', lists[l][0]); if (vid) rl.setValue('view', vid); rl.insert(); }
            var ent = new GlideRecord('sys_ui_related_list_entry');
            ent.addQuery('list_id', rl.getUniqueValue()); ent.addQuery('related_list', lists[l][1]); ent.query();
            if (!ent.next()) {
                var all = new GlideRecord('sys_ui_related_list_entry'); all.addQuery('list_id', rl.getUniqueValue()); all.orderByDesc('position'); all.setLimit(1); all.query();
                var max = all.next() ? parseInt(all.getValue('position') || '0', 10) : 0;
                ent.initialize(); ent.setValue('list_id', rl.getUniqueValue()); ent.setValue('related_list', lists[l][1]); ent.setValue('position', max + 1); ent.insert();
            }
        }
    }
    out('Related lists added to Case and Customer Contact.');

    // 4. Softphone (OpenFrame)
    if (ready && GlideTableDescriptor.isValid('sn_openframe_configuration')) {
        var portal = 'https://ccaas-embed-prod.azureedge.net/widget/index.html?dynamicsUrl=' + org.replace(/\/$/, '');
        var of = new GlideRecord('sn_openframe_configuration');
        of.addQuery('name', 'Dynamics 365 Contact Center'); of.query();
        if (!of.next()) { of.initialize(); of.setValue('name', 'Dynamics 365 Contact Center'); }
        of.setValue('title', 'Dynamics 365 Contact Center'); of.setValue('subtitle', 'Voice and messaging'); of.setValue('url', portal);
        of.setValue('width', '400'); of.setValue('height', '700'); of.setValue('order', '100'); of.setValue('active', true); of.setValue('default', true);
        of.setValue('show_presence_indicator', false); of.setValue('collapsed_view_enabled', false); of.setValue('enforce_sandbox_restrictions', false);
        if (of.isNewRecord()) of.insert(); else of.update();
        var role = new GlideRecord('sys_user_role');
        if (role.get('name', 'sn_openframe_user')) {
            var has = new GlideRecord('sys_user_has_role'); has.addQuery('user', gs.getUserID()); has.addQuery('role', role.getUniqueValue()); has.query();
            if (!has.next()) { has.initialize(); has.setValue('user', gs.getUserID()); has.setValue('role', role.getUniqueValue()); has.insert(); }
        }
        out('Softphone configured. Give the role sn_openframe_user to every agent who should see it.');
    } else if (ready) {
        out('OpenFrame is not available on this instance; skipped the softphone.');
    }
    out('Done.');
})();