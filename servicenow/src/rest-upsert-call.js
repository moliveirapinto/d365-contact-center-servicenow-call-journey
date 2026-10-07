(function process(/*RESTAPIRequest*/ request, /*RESTAPIResponse*/ response) {
    // Upsert a Contact Center Call by D365 conversation ID. Sent by the Dynamics 365 sync flow when a call ends.
    var body = request.body.data || {};
    var convId = String(body.conversation_id || '').trim();
    if (!convId) {
        response.setStatus(400);
        return { error: 'conversation_id is required' };
    }

    // Writable columns only; the server computes durations, title and links.
    var FIELDS = [
        'u_status', 'u_call_received', 'u_agent_connected', 'u_call_ended', 'u_queue', 'u_agent',
        'u_customer_sentiment', 'u_handled_by_virtual_agent', 'u_talk_time_seconds', 'u_wait_time_seconds',
        'u_handle_time_seconds', 'u_called_number', 'u_caller_phone', 'u_quality_score', 'u_quality_plan',
        'u_quality_summary', 'u_quality_action_plan', 'u_quality_evaluated_at', 'u_quality_evaluation_json'
    ];
    var DATES = { u_call_received: 1, u_agent_connected: 1, u_call_ended: 1, u_quality_evaluated_at: 1 };

    var gr = new GlideRecord('u_cc_call');
    gr.addQuery('u_conversation_id', convId);
    gr.setLimit(1);
    gr.query();

    // Agent accepted a call that has no Case yet: create it (the IVR normally does this, but not for direct calls).
    if ((body.create_case === true || body.create_case === 'true') && !gr.hasNext() && (!body.agent_connected || String(body.d365_channel || '192440000') !== '192440000')) return { skipped: 'not an accepted voice call yet' };
    if ((body.create_case === true || body.create_case === 'true') && gr.hasNext()) return { exists: true, conversation_id: convId };
    var caseCreated = '';
    if (!gr.hasNext() && (body.create_case === true || body.create_case === 'true')) {
        var existingCase = new GlideRecord('sn_customerservice_case');
        existingCase.addQuery('u_d365_conversation_id', convId);
        existingCase.setLimit(1);
        existingCase.query();
        if (!existingCase.next()) {
            var contactId = new D365CCUtil().findOrCreateContact(body.contact_name, body.contact_email, body.caller_phone);
            var nc = new GlideRecord('sn_customerservice_case');
            nc.initialize();
            nc.short_description = 'Inbound call' + (body.contact_name ? ' from ' + body.contact_name : '') + (body.subject ? ' - ' + body.subject : '');
            nc.description = 'Case created automatically when an agent accepted a Dynamics 365 Contact Center call.';
            nc.contact_type = 'phone';
            if (contactId) nc.contact = contactId;
            nc.u_d365_conversation_id = convId;
            caseCreated = nc.insert();
        }
        gr = new GlideRecord('u_cc_call');
        gr.addQuery('u_conversation_id', convId);
        gr.setLimit(1);
        gr.query();
    }
    var created = false;
    if (!gr.next()) {
        gr.initialize();
        gr.u_conversation_id = convId;
        gr.u_channel = 'Voice call';
        gr.u_direction = 'Inbound';
        // If the IVR already created the Case, link it.
        var cs = new GlideRecord('sn_customerservice_case');
        cs.addQuery('u_d365_conversation_id', convId);
        cs.setLimit(1);
        cs.query();
        if (cs.next()) gr.u_case = cs.getUniqueValue();
        created = true;
    }

    for (var i = 0; i < FIELDS.length; i++) {
        var f = FIELDS[i];
        var key = f.substring(2);
        if (body[key] === undefined || body[key] === null || body[key] === '') continue;
        var v = body[key];
        if (DATES[f]) {
            // ISO 8601 (2026-09-29T13:13:03Z) -> GlideDateTime (UTC)
            v = String(v).replace('T', ' ').replace(/\.\d+/, '').replace(/Z$/, '').replace(/[+-]00:?00$/, '');
        }
        gr.setValue(f, v);
    }

    // D365 is the source of truth for when the call started, so (re)derive the title from it.
    if (body.call_received) gr.u_title = new D365CCUtil().titleFor(gr.getValue('u_call_received'));
    var id = created ? gr.insert() : gr.update();
    return { sys_id: String(id || gr.getUniqueValue()), created: created, case_created: String(caseCreated), conversation_id: convId };
})(request, response);
