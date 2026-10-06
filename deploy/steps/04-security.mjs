import { api, find, upsert, log, cfg } from '../lib.mjs';

// OpenFrame is ServiceNow's softphone/CTI side panel. Microsoft's documented setup for embedding the
// Dynamics 365 Contact Center conversation widget in ServiceNow is a single OpenFrame configuration record.
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

    // Let the people testing see the panel.
    const role = await find('sys_user_role', 'name=sn_openframe_user');
    const admin = await find('sys_user', `user_name=${cfg.user}`);
    if (role && admin && !(await find('sys_user_has_role', `user=${admin.sys_id}^role=${role.sys_id}`))) {
        await api('POST', '/api/now/table/sys_user_has_role', { user: admin.sys_id, role: role.sys_id });
        log('  granted sn_openframe_user to ' + cfg.user);
    }
}
