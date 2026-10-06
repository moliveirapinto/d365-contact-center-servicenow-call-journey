import { api, find, upsert, enc, cfg, log } from '../lib.mjs';

const T = 'u_cc_call';
const CASE = 'sn_customerservice_case';

// [element, label, type, maxLength, extras]
const CALL_COLUMNS = [
    ['u_title', 'Call', 'string', 255],
    ['u_status', 'Call Status', 'string', 40, { choices: ['In progress', 'Completed'], default: 'In progress' }],
    ['u_case', 'Case', 'reference', 32, { reference: CASE }],
    ['u_contact', 'Customer', 'reference', 32, { reference: 'customer_contact' }],
    ['u_conversation_id', 'D365 Conversation ID', 'string', 40, { unique: true }],
    ['u_channel', 'Channel', 'string', 40],
    ['u_direction', 'Direction', 'string', 40],
    ['u_call_received', 'Call Received', 'glide_date_time', 40],
    ['u_call_received_label', 'Call Received (display)', 'string', 120],
    ['u_agent_connected', 'Agent Connected', 'glide_date_time', 40],
    ['u_call_ended', 'Call Ended', 'glide_date_time', 40],
    ['u_queue', 'Queue', 'string', 120],
    ['u_agent', 'Agent', 'string', 120],
    ['u_customer_sentiment', 'Customer Sentiment', 'string', 40],
    ['u_caller_phone', 'Caller Phone', 'string', 40],
    ['u_called_number', 'Called Number', 'string', 120],
    ['u_handled_by_virtual_agent', 'Handled by Virtual Agent', 'boolean', 40],
    ['u_talk_time_seconds', 'Talk Time (sec)', 'integer', 40],
    ['u_wait_time_seconds', 'Queue Wait (sec)', 'integer', 40],
    ['u_handle_time_seconds', 'Handle Time (sec)', 'integer', 40],
    ['u_total_duration_seconds', 'Total Duration (sec)', 'integer', 40, { readonly: true }],
    ['u_virtual_agent_seconds', 'Virtual Agent Time (sec)', 'integer', 40, { readonly: true }],
    ['u_recording_url', 'Recording URL', 'string', 1000, { readonly: true }],
    ['u_recording', 'Recording & Transcript', 'html', 4000, { readonly: true }],
    ['u_quality_score', 'Quality Score', 'integer', 40],
    ['u_quality_plan', 'Evaluation Plan', 'string', 255],
    ['u_quality_summary', 'Evaluation Summary', 'string', 4000],
    ['u_quality_action_plan', 'Coaching Recommendation', 'string', 4000],
    ['u_quality_evaluated_at', 'Evaluated At', 'glide_date_time', 40],
    ['u_quality_evaluation_json', 'Evaluation Details (JSON)', 'string', 100000],
    ['u_journey_html', 'Call Journey', 'html', 65000, { readonly: true }]
];

const CASE_COLUMNS = [
    ['u_d365_conversation_id', 'D365 Conversation ID', 'string', 40, {}],
    ['u_d365_call_recording', 'Call Recording & Transcript', 'html', 4000, { readonly: true }],
    ['u_d365_recording_url', 'Recording URL', 'string', 1000, { readonly: true }],
    ['u_call_journey', 'Call Journey', 'html', 65000, { readonly: true }]
];

async function ensureColumn(table, [element, label, type, max, x = {}]) {
    const existing = await find('sys_dictionary', `name=${table}^element=${element}`);
    const row = {
        name: table,
        element,
        column_label: label,
        internal_type: type,
        max_length: String(max),
        active: 'true',
        read_only: x.readonly ? 'true' : 'false',
        unique: x.unique ? 'true' : 'false',
        ...(x.reference ? { reference: x.reference } : {}),
        ...(x.choices ? { choice: '1' } : {}),
        ...(x.default ? { default_value: x.default } : {})
    };
    if (existing) {
        await api('PATCH', `/api/now/table/sys_dictionary/${existing.sys_id}`, { column_label: label, read_only: row.read_only });
    } else {
        await api('POST', '/api/now/table/sys_dictionary', row);
    }
    await upsert('sys_documentation', `name=${table}^element=${element}^language=en`, {
        name: table, element, language: 'en', label, plural: label
    });
    if (x.choices) {
        let i = 0;
        for (const c of x.choices) {
            await upsert('sys_choice', `name=${table}^element=${element}^value=${c}`, {
                name: table, element, value: c, label: c, sequence: String(i++), language: 'en', inactive: 'false'
            });
        }
    }
}

export default async function schema() {
    // 1. The call table
    let tbl = await find('sys_db_object', `name=${T}`);
    if (!tbl) {
        const role = await find('sys_user_role', 'name=sn_customerservice_agent');
        tbl = await api('POST', '/api/now/table/sys_db_object', {
            name: T,
            label: 'Contact Center Call',
            plural: 'Contact Center Calls',
            create_access_controls: 'true',
            access: 'public',
            is_extendable: 'false',
            extension_model: '',
            ...(role ? { user_role: role.sys_id } : {})
        });
        log(`  created table ${T}`);
    } else {
        log(`  table ${T} exists`);
    }

    for (const c of CALL_COLUMNS) await ensureColumn(T, c);
    log(`  ${CALL_COLUMNS.length} call columns ok`);

    // Display value for references = the title
    const title = await find('sys_dictionary', `name=${T}^element=u_title`);
    await api('PATCH', `/api/now/table/sys_dictionary/${title.sys_id}`, { display: 'true' });

    // 2. Case columns
    for (const c of CASE_COLUMNS) await ensureColumn(CASE, c);
    log(`  ${CASE_COLUMNS.length} case columns ok`);

    // 3. Settings (the equivalent of the Salesforce custom setting). Nothing is hard-coded in logic.
    const props = [
        ['d365cc.org_url', cfg.d365Url, 'Dynamics 365 environment URL, e.g. https://contoso.crm.dynamics.com'],
        ['d365cc.app_id', cfg.d365AppId, 'Optional. App ID of the Contact Center Call Review model-driven app'],
        ['d365cc.time_zone', cfg.timezone, 'IANA time zone used for call titles, e.g. America/New_York'],
        ['d365cc.time_zone_label', cfg.timezoneLabel, 'Short label shown at the end of call titles, e.g. ET']
    ];
    for (const [name, value, description] of props) {
        await upsert('sys_properties', `name=${name}`, { name, value, description, type: 'string', suffix: 'd365cc' });
    }
    log('  settings properties ok');
}
