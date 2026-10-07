import { api, find, upsert, log, cfg } from '../lib.mjs';

// OpenFrame is ServiceNow's softphone/CTI side panel. Microsoft's documented setup for embedding the
// Dynamics 365 Contact Center conversation widget in ServiceNow is a single OpenFrame configuration record.
const BR_SOFTPHONE = `(function executeRule(current, previous) {
    // Keeps the softphone (OpenFrame) pointed at the Dynamics 365 environment set in d365cc.org_url.
    try {
        var of = new GlideRecord('sn_openframe_configuration');
        if (!of.get('name', 'Dynamics 365 Contact Center')) return;
        var url = of.getValue('url') || '';
        // A hand-edited URL (for example a custom widget URL) is left alone.
        if (url && url.indexOf('dynamicsUrl=') < 0) return;
        var base = url.indexOf('?') > 0 ? url.substring(0, url.indexOf('?')) : 'https://ccaas-embed-prod.azureedge.net/widget/index.html';
        of.setValue('url', base + '?dynamicsUrl=' + String(current.getValue('value') || '').replace(/\\/$/, ''));
        of.update();
    } catch (e) {
        gs.error('[D365CC] Could not update the softphone URL: ' + e);
    }
})(current, previous);`;
export default async function cti() {
    // Copilot Service admin center > Your default contact center > Conversation widget > "Embeddable conversation widget URL"
    const portal = process.env.D365_WIDGET_URL ||
        `https://ccaas-embed-prod.azureedge.net/widget/index.html?dynamicsUrl=${cfg.d365Url}`;

    const id = await upsert('sn_openframe_configuration', 'name=Dynamics 365 Contact Center', {
        name: 'Dynamics 365 Contact Center',
        title: 'Dynamics 365 Contact Center',
        subtitle: 'Voice and messaging',
        url: portal,
        width: '400',
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
        description: 'When d365cc.org_url changes, point the Dynamics 365 Contact Center softphone at it.'
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
