import { api, find, upsert, log, cfg } from '../lib.mjs';

// OpenFrame is ServiceNow's softphone/CTI side panel. The Dynamics 365 Contact Center panel is a single OpenFrame
// configuration record; by default it shows the Edge host page /d365cc_edge.do (see 08-edge.mjs).
const BR_SOFTPHONE = `(function executeRule(current, previous) {
    // Classic widget only: keeps its URL pointed at the Dynamics 365 environment set in d365cc.org_url.
    // The Edge host page (/d365cc_edge.do) reads d365cc.org_url itself, so it needs no update.
    try {
        var of = new GlideRecord('sn_openframe_configuration');
        if (!of.get('name', 'Dynamics 365 Contact Center')) return;
        var url = of.getValue('url') || '';
        if (!url || url.indexOf('dynamicsUrl=') < 0) return;
        var base = url.indexOf('?') > 0 ? url.substring(0, url.indexOf('?')) : 'https://ccaas-embed-prod.azureedge.net/widget/index.html';
        of.setValue('url', base + '?dynamicsUrl=' + String(current.getValue('value') || '').replace(/\\/$/, ''));
        of.update();
    } catch (e) {
        gs.error('[D365CC] Could not update the softphone URL: ' + e);
    }
})(current, previous);`;
export default async function cti() {
    // Default: the new Contact Center Edge desktop, through the d365cc_edge host page (step 08-edge). The URL is
    // relative, so the same record works on every instance, and the page reads d365cc.org_url itself.
    // D365_WIDGET=classic keeps the older embeddable conversation widget (Copilot Service admin center >
    // Your default contact center > Conversation widget > "Embeddable conversation widget URL").
    const classic = String(process.env.D365_WIDGET || '').toLowerCase() === 'classic';
    const portal = process.env.D365_WIDGET_URL ||
        (classic ? `https://ccaas-embed-prod.azureedge.net/widget/index.html?dynamicsUrl=${cfg.d365Url}` : '/d365cc_edge.do');

    const isEdge = portal.indexOf('d365cc_edge.do') >= 0;
    const id = await upsert('sn_openframe_configuration', 'name=Dynamics 365 Contact Center', {
        name: 'Dynamics 365 Contact Center',
        title: 'Dynamics 365 Contact Center',
        subtitle: 'Voice and messaging',
        url: portal,
        width: isEdge ? '480' : '400',
        height: '700',
        order: '100',
        active: 'true',
        default: 'true',
        show_presence_indicator: 'false',
        collapsed_view_enabled: 'false',
        enforce_sandbox_restrictions: 'false'
    });
    log(`  openframe configuration ${id}`);

    await upsert('sys_script', 'name=D365CC - Update softphone URL^collection=sys_properties', {
        name: 'D365CC - Update softphone URL', collection: 'sys_properties', when: 'after', order: '100', action_insert: 'true', action_update: 'true', action_delete: 'false', action_query: 'false',
        filter_condition: 'name=d365cc.org_url^EQ', script: BR_SOFTPHONE, active: 'true', advanced: 'true',
        description: 'Classic widget only: when d365cc.org_url changes, point the classic Dynamics 365 softphone URL at it. The Edge host page needs nothing.'
    });
    log('  softphone URL rule ok');

    // Let the people testing see the panel.
    const role = await find('sys_user_role', 'name=sn_openframe_user');
    const admin = await find('sys_user', `user_name=${cfg.user}`);
    if (role && admin && !(await find('sys_user_has_role', `user=${admin.sys_id}^role=${role.sys_id}`))) {
        await api('POST', '/api/now/table/sys_user_has_role', { user: admin.sys_id, role: role.sys_id });
        log('  granted sn_openframe_user to ' + cfg.user);
    }
}
