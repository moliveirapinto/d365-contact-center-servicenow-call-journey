import { api, find, upsert, readSrc, log, MODE } from '../lib.mjs';

const CALL = 'u_cc_call';
const CASE = MODE.record;
const CUST = MODE.customerField;

const BR_CALC = `(function executeRule(current, previous) {
    var util = new D365CCUtil();
    var received = current.getValue('u_call_received');

    var channel = current.getValue('u_channel');
    if (received && current.u_title.nil()) current.u_title = util.titleFor(received, channel);
    if (received) current.u_call_received_label = util.titleFor(received, channel).replace(/^.*? (received|started) on /, '');
    if (!current.u_conversation_id.nil()) current.u_conversation_id = String(current.getValue('u_conversation_id')).trim();

    // Total duration = ended - received
    var total = util.secondsBetween(received, current.getValue('u_call_ended'));
    current.u_total_duration_seconds = total === '' ? '' : String(total);

    // Virtual agent time = (agent connected - received) - queue wait, never negative
    var toAgent = util.secondsBetween(received, current.getValue('u_agent_connected'));
    var va = '';
    if (toAgent !== '') {
        var wait = parseInt(current.getValue('u_wait_time_seconds') || '0', 10) || 0;
        va = Math.max(0, toAgent - wait);
    }
    current.u_virtual_agent_seconds = va === '' ? '' : String(va);

    // Inherit the customer from the Case when the call has none
    if (current.u_contact.nil() && !current.u_case.nil()) {
        var cs = new GlideRecord('${CASE}');
        if (cs.get(current.getValue('u_case'))) current.u_contact = cs.getValue('${CUST}');
    }
})(current, previous);`;

const BR_CASE = `(function executeRule(current, previous) {
    // Create the "Contact Center Call" when the IVR stamps a D365 conversation ID on the Case.
    // Wrapped in try/catch so it can never block or roll back Case creation.
    try {
        if (!current.u_d365_conversation_id.changes()) return;
        var convId = String(current.getValue('u_d365_conversation_id') || '').trim();
        if (!convId) return;

        var existing = new GlideRecord('${CALL}');
        existing.addQuery('u_conversation_id', convId);
        existing.setLimit(1);
        existing.query();
        if (existing.next()) {
            if (existing.u_case.nil()) {
                existing.u_case = current.getUniqueValue();
                existing.update();
            }
            return;
        }

        var util = new D365CCUtil();
        var call = new GlideRecord('${CALL}');
        call.initialize();
        call.u_conversation_id = convId;
        call.u_case = current.getUniqueValue();
        call.u_contact = current.getValue('${CUST}');
        call.u_call_received = current.getValue('sys_created_on');
        call.u_title = util.titleFor(current.getValue('sys_created_on'));
        call.u_channel = 'Voice call';
        call.u_direction = 'Inbound';
        call.u_handled_by_virtual_agent = true;
        call.u_status = 'In progress';
        if (!current.${CUST}.nil()) {
            call.u_caller_phone = current.${CUST}.mobile_phone.toString() || current.${CUST}.phone.toString();
        }
        call.insert();
    } catch (e) {
        gs.error('[D365CC] Could not create call for case ' + current.getValue('number') + ': ' + e);
    }
})(current, previous);`;

const BR_ACTIVITY = `(function executeRule(current, previous) {
    // Post the call to the Case's Activity stream (the equivalent of the Salesforce case-feed entry).
    try {
        if (current.u_case.nil()) return;
        var isInsert = current.operation() == 'insert';
        var completed = current.getValue('u_status') == 'Completed' && (isInsert || current.u_status.changes() || current.u_case.changes());

        var util = new D365CCUtil();
        var cs = new GlideRecord('${CASE}');
        if (!cs.get(current.getValue('u_case'))) return;

        var post = function (kind) {
            var marker = 'Contact Center ' + util.noun(current.getValue('u_channel')) + (kind === 'created' ? ' created' : ' completed');
            var seen = new GlideRecord('sys_journal_field');
            seen.addQuery('element_id', cs.getUniqueValue());
            seen.addQuery('element', 'work_notes');
            seen.addQuery('value', 'CONTAINS', marker);
            seen.addQuery('value', 'CONTAINS', current.getUniqueValue());
            seen.setLimit(1);
            seen.query();
            if (seen.next()) return;
            cs.work_notes = util.activityNote(current, kind);
            cs.update();
        };

        // One entry per call: posted when the call completes (an in-progress call has no entry yet).
        if (completed) {
            post('completed');
            // Write the call summary as resolution notes (notes typed by an agent are left alone).
            var rec = new GlideRecord('${CASE}');
            if (rec.get(current.getValue('u_case')) && rec.isValidField('close_notes')) {
                var cur = rec.getValue('close_notes') || '';
                if (!cur || cur.indexOf('[D365CC]') === 0) {
                    var noun = util.noun(current.getValue('u_channel'));
                    var secs = parseInt(current.getValue(noun === 'call' ? 'u_talk_time_seconds' : 'u_handle_time_seconds') || '0', 10);
                    var parts = ['[D365CC] Resolved on a Dynamics 365 Contact Center ' + noun + ' (' + (current.getValue('u_title') || noun) + ').'];
                    if (current.getDisplayValue('u_agent')) parts.push('Agent: ' + current.getDisplayValue('u_agent') + '.');
                    if (secs) parts.push((noun === 'call' ? 'Talk time: ' : 'Handle time: ') + Math.floor(secs / 60) + 'm ' + (secs % 60) + 's.');
                    if (current.getDisplayValue('u_customer_sentiment')) parts.push('Customer sentiment: ' + current.getDisplayValue('u_customer_sentiment') + '.');
                    if (current.getValue('u_quality_summary')) parts.push('Summary: ' + current.getValue('u_quality_summary'));
                    rec.setValue('close_notes', parts.join(' '));
                    rec.update();
                }
            }
        }
    } catch (e) {
        gs.error('[D365CC] Could not post call to Case activity: ' + e);
    }
})(current, previous);`;

const BR_RESOLUTION = `(function executeRule(current, previous) {
    // Records from Dynamics 365 Contact Center always carry a resolution code. The resolution notes are written when the call completes (see the Activity rule).
    try {
        if (current.u_d365_conversation_id.nil()) return;
        var codeField = current.isValidField('close_code') ? 'close_code' : (current.isValidField('resolution_code') ? 'resolution_code' : '');
        if (codeField && !current.getValue(codeField)) {
            var ch = new GlideRecord('sys_choice');
            ch.addQuery('name', current.getTableName());
            ch.addQuery('element', codeField);
            ch.addQuery('value', 'Solution provided');
            ch.addQuery('inactive', false);
            ch.setLimit(1);
            ch.query();
            if (ch.hasNext()) current.setValue(codeField, 'Solution provided');
        }
    } catch (e) {
        gs.error('[D365CC] Could not fill resolution fields: ' + e);
    }
})(current, previous);`;
async function scriptInclude(name, scriptText, description) {
    return upsert('sys_script_include', `name=${name}`, {
        name, api_name: `global.${name}`, script: scriptText, active: 'true', access: 'public',
        client_callable: 'false', description
    });
}

async function businessRule(name, table, when, order, insert, update, scriptText, description) {
    return upsert('sys_script', `name=${name}^collection=${table}`, {
        name, collection: table, when, order: String(order),
        action_insert: String(insert), action_update: String(update), action_delete: 'false', action_query: 'false',
        script: scriptText, active: 'true', advanced: 'true', description
    });
}

async function virtualField(table, element, calcScript) {
    const d = await find('sys_dictionary', `name=${table}^element=${element}`);
    if (!d) throw new Error(`column ${table}.${element} missing; run 01-schema first`);
    await api('PATCH', `/api/now/table/sys_dictionary/${d.sys_id}`, {
        virtual: 'true', virtual_type: 'script', calculation: calcScript, read_only: 'true'
    });
}

export default async function logic() {
    await scriptInclude('D365CCIcons', readSrc('D365CCIcons.js'), 'D365 Contact Center: Fluent System Icons (MIT) as inline images');
    await scriptInclude('D365CCUtil', readSrc('D365CCUtil.js'), 'D365 Contact Center: settings, URLs, titles and time helpers');
    await scriptInclude('D365CCJourney', readSrc('D365CCJourney.js'), 'D365 Contact Center: renders the Call Journey card');
    log('  script includes ok');

    await businessRule('D365CC - Calculate call fields', CALL, 'before', 100, true, true, BR_CALC,
        'Fills title, total duration and virtual agent time; inherits the customer from the Case.');
    await businessRule('D365CC - Create call from IVR case', CASE, 'after', 200, true, true, BR_CASE,
        'When the Copilot Studio IVR sets the D365 Conversation ID on a Case, create the matching Contact Center Call.');
    await businessRule('D365CC - Fill resolution fields', CASE, 'before', 150, true, true, BR_RESOLUTION,
        'Sets the Resolution code on records that come from a Contact Center call.');
    await businessRule('D365CC - Post call to Case activity', CALL, 'after', 300, true, true, BR_ACTIVITY,
        'Adds Contact Center Call created / completed entries (with a link to the call journey) to the Case activity stream.');
    log('  business rules ok');

    // Calculated (virtual) fields: always live, rendered in each viewer's own time zone, follow the d365cc.* settings.
    await virtualField(CALL, 'u_journey_html', '(function calculatedFieldValue(current) {\n  return new D365CCJourney().forCall(current.getUniqueValue());\n})(current);');
    await virtualField(CALL, 'u_recording_url', "(function calculatedFieldValue(current) {\n  return new D365CCUtil().conversationUrl(current.getValue('u_conversation_id'), true);\n})(current);");
    await virtualField(CALL, 'u_recording', "(function calculatedFieldValue(current) {\n  var u = new D365CCUtil().conversationUrl(current.getValue('u_conversation_id'), false);\n  return u ? '<a href=\"' + u + '\" target=\"_blank\" rel=\"noopener\">Open call recording &amp; transcript</a>' : '';\n})(current);");
    await virtualField(CASE, 'u_call_journey', '(function calculatedFieldValue(current) {\n  return new D365CCJourney().forCase(current.getUniqueValue());\n})(current);');
    await virtualField(CASE, 'u_d365_call_recording', "(function calculatedFieldValue(current) {\n  var u = new D365CCUtil().conversationUrl(current.getValue('u_d365_conversation_id'), false);\n  return u ? '<a href=\"' + u + '\" target=\"_blank\" rel=\"noopener\">Open call recording &amp; transcript</a>' : '';\n})(current);");
    await virtualField(CASE, 'u_d365_recording_url', "(function calculatedFieldValue(current) {\n  return new D365CCUtil().conversationUrl(current.getValue('u_d365_conversation_id'), true);\n})(current);");
    log('  calculated fields ok');
    // HTML fields render in a TinyMCE frame; give the journey cards room instead of a tiny scroll box.
    for (const [table, el, h] of [[CALL, 'u_journey_html', 340], [CASE, 'u_call_journey', 1000]]) {
        const d = await find('sys_dictionary', `name=${table}^element=${el}`);
        await api('PATCH', `/api/now/table/sys_dictionary/${d.sys_id}`, { attributes: `editor.height=${h},html_sanitize=false` });
    }
}
