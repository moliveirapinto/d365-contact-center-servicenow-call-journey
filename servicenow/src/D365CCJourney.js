var D365CCJourney = Class.create();
D365CCJourney.prototype = {
    initialize: function () {
        this.util = new D365CCUtil();
    },

    SENTIMENT: {
        'Very positive': ['😄', '#2e844a'],
        'Positive': ['😊', '#2e844a'],
        'Slightly positive': ['🙂', '#2e844a'],
        'Neutral': ['😐', '#5f6b7a'],
        'Slightly negative': ['🙁', '#ba0517'],
        'Negative': ['😟', '#ba0517'],
        'Very negative': ['😠', '#ba0517']
    },

    esc: function (s) {
        return String(s === null || s === undefined ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    },

    secs: function (n) {
        if (n === '' || n === null || n === undefined) return '';
        var v = Math.round(Number(n));
        if (isNaN(v)) return '';
        if (v < 60) return v + 's';
        var m = Math.floor(v / 60), s = v % 60;
        return m + 'm ' + (s < 10 ? '0' : '') + s + 's';
    },

    // Times and dates are shown in the viewing user's own time zone (GlideDateTime display values).
    local: function (value) {
        if (!value) return null;
        var gdt = new GlideDateTime(value);
        var disp = String(gdt.getDisplayValue()); // yyyy-MM-dd HH:mm:ss
        var h = parseInt(disp.substr(11, 2), 10);
        var mm = disp.substr(14, 2);
        var months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
        var days = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
        return {
            time: (h % 12 === 0 ? 12 : h % 12) + ':' + mm + ' ' + (h < 12 ? 'AM' : 'PM'),
            month: months[parseInt(disp.substr(5, 2), 10) - 1],
            day: String(parseInt(disp.substr(8, 2), 10)),
            weekday: days[gdt.getDayOfWeekLocalTime() - 1],
            full: disp
        };
    },

    scoreBand: function (s) {
        if (s >= 71) return ['Good', '#2e844a', '#e3f3e8'];
        if (s >= 41) return ['Fair', '#b45309', '#fef3c7'];
        return ['Poor', '#ba0517', '#fde8ea'];
    },

    pill: function (text, color, bg) {
        return '<span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600;color:' + color +
            ';background:' + bg + ';">' + text + '</span>';
    },

    button: function (label, href, primary) {
        return '<a href="' + href + '" target="_blank" rel="noopener" style="display:inline-block;margin:0 8px 4px 0;padding:5px 12px;border-radius:6px;font-size:12px;font-weight:600;text-decoration:none;' +
            (primary ? 'background:#1b6ac9;color:#fff;border:1px solid #1b6ac9;' : 'background:#fff;color:#1b6ac9;border:1px solid #1b6ac9;') + '">' + label + '</a>';
    },

    chip: function (text) {
        return '<span style="display:inline-block;margin:0 6px 6px 0;padding:3px 10px;border:1px solid #d8dde6;border-radius:12px;font-size:12px;color:#3e3e3c;background:#f8f9fb;">' + text + '</span>';
    },

    step: function (icon, label, meta, state) {
        var done = state === 'done', live = state === 'live' || state === 'active';
        var bg = done ? '#1b6ac9' : (live ? '#fff' : '#c9d1dc');
        var bd = done ? '#1b6ac9' : (live ? '#1b6ac9' : '#c9d1dc');
        return '<td style="text-align:center;vertical-align:top;padding:0 4px;width:20%;">' +
            '<div style="width:34px;height:34px;line-height:30px;margin:0 auto 4px;border-radius:50%;border:2px solid ' + bd + ';background:' + bg + ';font-size:15px;">' + icon + '</div>' +
            '<div style="font-size:12px;font-weight:600;color:#181818;">' + this.esc(label) + '</div>' +
            '<div style="font-size:11px;color:#5f6b7a;min-height:14px;">' + this.esc(meta) + '</div></td>';
    },

    renderCall: function (gr, full) {
        var self = this;
        var done = gr.getValue('u_status') === 'Completed';
        var rcv = this.local(gr.getValue('u_call_received'));
        var conn = this.local(gr.getValue('u_agent_connected'));
        var end = this.local(gr.getValue('u_call_ended'));
        var vaSecs = this.secs(gr.getValue('u_virtual_agent_seconds'));
        var wait = this.secs(gr.getValue('u_wait_time_seconds'));
        var queue = gr.getValue('u_queue') || 'Voice';
        var agent = gr.getValue('u_agent') || 'Agent';
        var sentiment = gr.getValue('u_customer_sentiment');
        var sent = this.SENTIMENT[sentiment];
        var url = this.util.conversationUrl(gr.getValue('u_conversation_id'), false);

        var steps = '<table style="width:100%;border-collapse:collapse;margin:12px 0;"><tr>' +
            this.step('📞', 'Call received', rcv ? rcv.time : '', 'done') +
            this.step('🤖', 'Virtual agent', vaSecs || (done ? '' : 'handled'), 'done') +
            this.step('⏳', queue + ' queue', wait ? 'wait ' + wait : '', (conn || done) ? 'done' : 'active') +
            this.step('🎧', agent, conn ? 'answered ' + conn.time : (done ? '' : 'connecting…'), done ? 'done' : 'active') +
            this.step(done ? '✅' : '🔴', done ? 'Call ended' : 'In progress', done ? (end ? end.time : '') : 'live', done ? 'done' : 'live') +
            '</tr></table>';

        var chips = this.chip('⏱ Total ' + (this.secs(gr.getValue('u_total_duration_seconds')) || (done ? '—' : 'live')));
        if (gr.getValue('u_talk_time_seconds')) chips += this.chip('🗣 Talk ' + this.secs(gr.getValue('u_talk_time_seconds')));
        if (sentiment) chips += this.chip((sent ? sent[0] + ' ' : '') + '<span style="color:' + (sent ? sent[1] : '#3e3e3c') + ';font-weight:600;">' + this.esc(sentiment) + '</span>');
        if (gr.getValue('u_caller_phone')) chips += this.chip('📱 ' + this.esc(gr.getValue('u_caller_phone')));

        var status = done ? this.pill('Completed', '#2e844a', '#e3f3e8') : this.pill('● Live', '#ba0517', '#fde8ea');
        var tile = rcv ? '<td style="width:58px;vertical-align:top;"><div style="width:52px;border:1px solid #d8dde6;border-radius:8px;text-align:center;overflow:hidden;">' +
            '<div style="background:#1b6ac9;color:#fff;font-size:10px;font-weight:700;padding:2px 0;">' + rcv.month + '</div>' +
            '<div style="font-size:20px;font-weight:700;color:#181818;line-height:1.2;">' + rcv.day + '</div>' +
            '<div style="font-size:10px;color:#5f6b7a;padding-bottom:3px;">' + rcv.weekday + '</div></div></td>' : '';

        var html = '<table style="width:100%;border-collapse:collapse;"><tr>' + tile + '<td style="vertical-align:top;">' +
            '<div style="font-size:14px;font-weight:700;color:#181818;">📞 Inbound voice call &nbsp;' + status + '</div>' +
            '<div style="font-size:12px;color:#5f6b7a;margin-top:2px;">' + (rcv ? this.esc(rcv.full) : '') + '</div>' +
            steps + '<div>' + chips + '</div>' +
            (url ? '<div style="margin:4px 0 2px;">' + this.button('▶ Play recording', '/d365cc_recording.do?sysparm_call=' + gr.getUniqueValue(), true) + this.button('📄 Transcript', '/d365cc_recording.do?sysparm_call=' + gr.getUniqueValue(), false) + (full ? '' : this.button('Call details', '/now/cwf/agent/record/u_cc_call/' + gr.getUniqueValue(), false)) + '</div>' : '') +
            '</td></tr></table>';

        if (full) html += this.renderQuality(gr);
        return html;
    },

    renderQuality: function (gr) {
        var raw = gr.getValue('u_quality_score');
        if (raw === null || raw === '') return '';
        var score = Number(raw);
        var band = this.scoreBand(score);
        var html = '<div style="margin-top:14px;padding-top:12px;border-top:1px solid #e5e8ee;">' +
            '<div style="font-size:14px;font-weight:700;color:#181818;">AI quality evaluation</div>' +
            '<div style="margin:8px 0;"><span style="display:inline-block;min-width:54px;padding:6px 12px;border-radius:8px;font-size:22px;font-weight:700;text-align:center;color:' + band[1] + ';background:' + band[2] + ';">' + score + '</span> ' +
            '&nbsp;' + this.pill(band[0], band[1], band[2]) + ' &nbsp;<span style="font-size:12px;color:#5f6b7a;">' + this.esc(gr.getValue('u_quality_plan') || 'Quality evaluation') + '</span></div>';
        var summary = gr.getValue('u_quality_summary');
        if (summary) html += '<div style="font-size:13px;color:#3e3e3c;margin:6px 0;"><b>Summary.</b> ' + this.esc(summary) + '</div>';
        var plan = gr.getValue('u_quality_action_plan');
        if (plan) html += '<div style="font-size:13px;color:#3e3e3c;margin:6px 0;padding:8px 10px;background:#f4f6fa;border-left:3px solid #1b6ac9;"><b>Coaching recommendation.</b> ' + this.esc(plan) + '</div>';

        var inds = [];
        try {
            var j = JSON.parse(gr.getValue('u_quality_evaluation_json') || '{}');
            inds = (j.evaluation_result && j.evaluation_result.responses) || [];
        } catch (e) { inds = []; }
        if (inds.length) {
            var toneBy = { Normal: ['#2e844a', '#e3f3e8'], Warning: ['#b45309', '#fef3c7'], Critical: ['#ba0517', '#fde8ea'] };
            html += '<table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:12px;">';
            for (var i = 0; i < inds.length; i++) {
                var r = inds[i];
                var q = (r.questionInfo && r.questionInfo[0]) || {};
                var b = this.scoreBand(r.monitorScore);
                var t = toneBy[r.matchedBandLabel] || [b[1], b[2]];
                var w = Math.max(3, Math.min(100, r.monitorScore));
                html += '<tr style="border-top:1px solid #eef0f4;"><td style="padding:6px 6px 6px 0;vertical-align:top;width:34%;"><b>' + this.esc(r.monitorName) + '</b>' +
                    '<div style="margin-top:4px;height:6px;background:#ecebea;border-radius:3px;"><div style="width:' + w + '%;height:6px;border-radius:3px;background:' + t[0] + ';"></div></div></td>' +
                    '<td style="padding:6px;vertical-align:top;width:70px;">' + this.pill(this.esc(r.monitorScore), t[0], t[1]) + '</td>' +
                    '<td style="padding:6px 0;vertical-align:top;color:#3e3e3c;">' + this.esc((q.reason || q.answerText || '').replace(/^\s+|\s+$/g, '')) + '</td></tr>';
            }
            html += '</table>';
        }
        return html + '</div>';
    },

    // Journey for one call record (call form).
    forCall: function (callSysId) {
        var gr = new GlideRecord('u_cc_call');
        if (!gr.get(callSysId)) return '';
        return this.wrap(this.renderCall(gr, true));
    },

    // Journey for every call linked to a Case (newest first).
    forCase: function (caseSysId) {
        var gr = new GlideRecord('u_cc_call');
        gr.addQuery('u_case', caseSysId);
        gr.orderByDesc('u_call_received');
        gr.setLimit(10);
        gr.query();
        var parts = [];
        while (gr.next()) parts.push(this.renderCall(gr, false));
        if (!parts.length) return '';
        return this.wrap(parts.join('<hr style="border:0;border-top:1px solid #e5e8ee;margin:10px 0;"/>'));
    },

    wrap: function (inner) {
        return '<div style="font-family:Source Sans Pro,Helvetica,Arial,sans-serif;border:1px solid #d8dde6;border-radius:10px;padding:14px 16px;background:#fff;">' + inner + '</div>';
    },

    type: 'D365CCJourney'
};
