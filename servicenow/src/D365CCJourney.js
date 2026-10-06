var D365CCJourney = Class.create();
D365CCJourney.prototype = {
    initialize: function () {
        this.util = new D365CCUtil();
        this.icons = new D365CCIcons();
    },

    // Fluent 2 neutral / brand / status palette
    C: {
        text: '#242424', text2: '#616161', text3: '#8a8a8a',
        line: '#e0e0e0', lineSoft: '#ebebeb', surface: '#ffffff', subtle: '#fafafa', subtle2: '#f5f5f5',
        brand: '#0f6cbd', brandBg: '#ebf3fc', brandDark: '#115ea3',
        ok: '#107c10', okBg: '#dff6dd', warn: '#9d5d00', warnBg: '#fff4ce', bad: '#b10e1c', badBg: '#fdf3f4'
    },

    FONT: "'Segoe UI Variable Text','Segoe UI',system-ui,-apple-system,Roboto,Helvetica,Arial,sans-serif",

    // sentiment label -> [icon, tone colour]
    SENTIMENT: {
        'Very positive': ['happy', '#107c10'], 'Positive': ['happy', '#107c10'], 'Slightly positive': ['smile', '#107c10'],
        'Neutral': ['neutral', '#616161'],
        'Slightly negative': ['sad', '#9d5d00'], 'Negative': ['sad', '#b10e1c'], 'Very negative': ['angry', '#b10e1c']
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
        if (m < 60) return m + 'm ' + (s < 10 ? '0' : '') + s + 's';
        return Math.floor(m / 60) + 'h ' + (m % 60 < 10 ? '0' : '') + (m % 60) + 'm';
    },

    // Times and dates are shown in the viewing user's own time zone (GlideDateTime display values).
    local: function (value) {
        if (!value) return null;
        var gdt = new GlideDateTime(value);
        var disp = String(gdt.getDisplayValue()); // yyyy-MM-dd HH:mm:ss
        var h = parseInt(disp.substr(11, 2), 10);
        var mm = disp.substr(14, 2);
        var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        var days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        var mon = months[parseInt(disp.substr(5, 2), 10) - 1];
        var day = String(parseInt(disp.substr(8, 2), 10));
        var wk = days[gdt.getDayOfWeekLocalTime() - 1];
        var time = (h % 12 === 0 ? 12 : h % 12) + ':' + mm + ' ' + (h < 12 ? 'AM' : 'PM');
        return { time: time, mon: mon, day: day, wk: wk, full: wk + ', ' + mon + ' ' + day + ', ' + disp.substr(0, 4) + ' at ' + time };
    },

    scoreBand: function (s) {
        if (s >= 71) return ['Good', '#107c10', '#dff6dd'];
        if (s >= 41) return ['Fair', '#9d5d00', '#fff4ce'];
        return ['Poor', '#b10e1c', '#fdf3f4'];
    },

    icon: function (name, size, color) { return this.icons.img(name, size, color); },

    badge: function (text, color, bg) {
        return '<span style="display:inline-block;padding:2px 10px;border-radius:10px;font-size:12px;font-weight:600;line-height:18px;color:' + color + ';background:' + bg + ';">' + text + '</span>';
    },

    // Icon + text on one line
    inline: function (iconName, color, html, size) {
        return '<span style="display:inline-flex;align-items:center;gap:6px;">' + '<span style="display:inline-block;width:' + (size || 16) + 'px;height:' + (size || 16) + 'px;">' + this.icon(iconName, size || 16, color) + '</span>' + html + '</span>';
    },

    button: function (iconName, label, href, primary) {
        var C = this.C;
        var style = 'display:inline-flex;align-items:center;gap:6px;margin:0 8px 0 0;padding:6px 14px;border-radius:4px;font-size:13px;font-weight:600;line-height:20px;text-decoration:none;' +
            (primary ? 'background:' + C.brand + ';color:#ffffff;border:1px solid ' + C.brand + ';' : 'background:#ffffff;color:' + C.text + ';border:1px solid #d1d1d1;');
        return '<a href="' + href + '" target="_blank" rel="noopener" style="' + style + '">' +
            '<span style="display:inline-block;width:16px;height:16px;">' + this.icon(iconName, 16, primary ? '#ffffff' : C.text2) + '</span>' + label + '</a>';
    },

    stat: function (iconName, iconColor, label, value) {
        var C = this.C;
        return '<div style="display:inline-flex;align-items:center;gap:10px;margin:0 8px 8px 0;padding:8px 14px;border:1px solid ' + C.lineSoft + ';border-radius:6px;background:' + C.subtle + ';">' +
            '<span style="display:inline-block;width:20px;height:20px;">' + this.icon(iconName, 20, iconColor) + '</span>' +
            '<span style="display:inline-block;"><span style="display:block;font-size:11px;line-height:14px;color:' + C.text2 + ';">' + label + '</span>' +
            '<span style="display:block;font-size:13px;line-height:18px;font-weight:600;color:' + C.text + ';">' + value + '</span></span></div>';
    },

    // One step of the connected timeline. state: done | active | live | pending
    step: function (iconName, label, meta, state) {
        var C = this.C;
        var circle, iconColor;
        if (state === 'done') { circle = 'background:' + C.brand + ';border:2px solid ' + C.brand + ';'; iconColor = '#ffffff'; }
        else if (state === 'live') { circle = 'background:' + C.badBg + ';border:2px solid ' + C.bad + ';'; iconColor = C.bad; }
        else if (state === 'active') { circle = 'background:#ffffff;border:2px solid ' + C.brand + ';'; iconColor = C.brand; }
        else { circle = 'background:' + C.subtle2 + ';border:2px solid ' + C.line + ';'; iconColor = C.text3; }
        return '<div style="width:96px;text-align:center;">' +
            '<div style="width:36px;height:36px;margin:0 auto 8px;border-radius:50%;box-sizing:border-box;' + circle + '">' +
            '<div style="width:20px;height:20px;margin:6px;">' + this.icon(iconName, 20, iconColor) + '</div></div>' +
            '<div style="font-size:12px;line-height:16px;font-weight:600;color:' + C.text + ';">' + this.esc(label) + '</div>' +
            '<div style="font-size:11px;line-height:16px;color:' + C.text2 + ';min-height:16px;">' + this.esc(meta) + '</div></div>';
    },

    connector: function (filled) {
        return '<div style="flex:1;height:2px;margin:17px 2px 0;border-radius:1px;background:' + (filled ? this.C.brand : this.C.line) + ';"></div>';
    },

    renderCall: function (gr, full) {
        var C = this.C;
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
        var callId = gr.getUniqueValue();

        var status = done ? this.badge('Completed', C.ok, C.okBg) : this.badge('Live', C.bad, C.badBg);

        var header = '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">' +
            '<div style="display:flex;align-items:center;gap:12px;">' +
            '<div style="width:40px;height:40px;border-radius:8px;background:' + C.brandBg + ';"><div style="width:20px;height:20px;margin:10px;">' + this.icon('call_inbound', 20, C.brand) + '</div></div>' +
            '<div><div style="font-size:15px;line-height:20px;font-weight:600;color:' + C.text + ';">Inbound voice call</div>' +
            '<div style="font-size:12px;line-height:16px;color:' + C.text2 + ';">' + (rcv ? this.esc(rcv.full) : '') + '</div></div></div>' +
            '<div>' + status + '</div></div>';

        var timeline = '<div style="display:flex;align-items:flex-start;margin:20px 0 16px;">' +
            this.step('call_inbound', 'Call received', rcv ? rcv.time : '', 'done') + this.connector(true) +
            this.step('bot', 'Virtual agent', vaSecs || (done ? '' : 'handling'), 'done') + this.connector(true) +
            this.step('queue', queue + ' queue', wait ? 'waited ' + wait : '', (conn || done) ? 'done' : 'active') + this.connector(!!(conn || done)) +
            this.step('headset', agent, conn ? 'answered ' + conn.time : (done ? '' : 'connecting'), done ? 'done' : (conn ? 'active' : 'pending')) + this.connector(done) +
            this.step(done ? 'check' : 'live', done ? 'Call ended' : 'In progress', done ? (end ? end.time : '') : 'live', done ? 'done' : 'live') +
            '</div>';

        var stats = this.stat('timer', C.brand, 'Total duration', this.secs(gr.getValue('u_total_duration_seconds')) || (done ? '-' : 'Live'));
        if (gr.getValue('u_talk_time_seconds')) stats += this.stat('mic', C.brand, 'Talk time', this.secs(gr.getValue('u_talk_time_seconds')));
        if (sentiment) stats += this.stat(sent ? sent[0] : 'neutral', sent ? sent[1] : C.text2, 'Customer sentiment', this.esc(sentiment));
        if (gr.getValue('u_caller_phone')) stats += this.stat('phone', C.brand, 'Caller', this.esc(gr.getValue('u_caller_phone')));
        stats = '<div>' + stats + '</div>';

        var html = '<div style="font-family:' + this.FONT + ';color:' + C.text + ';">' + header + timeline + stats + '</div>';
        if (full) html += this.renderQuality(gr);
        return html;
    },

    renderQuality: function (gr) {
        var C = this.C;
        var raw = gr.getValue('u_quality_score');
        if (raw === null || raw === '') return '';
        var score = Number(raw);
        var band = this.scoreBand(score);

        var inds = [];
        try {
            var j = JSON.parse(gr.getValue('u_quality_evaluation_json') || '{}');
            inds = (j.evaluation_result && j.evaluation_result.responses) || [];
        } catch (e) { inds = []; }
        var attention = 0;
        for (var a = 0; a < inds.length; a++) if (inds[a].monitorScore < 71) attention++;

        var ring = '<div style="width:72px;height:72px;border-radius:50%;background:conic-gradient(' + band[1] + ' ' + (score * 3.6) + 'deg,#e8e8e8 0deg);">' +
            '<div style="width:56px;height:56px;margin:8px;border-radius:50%;background:#ffffff;text-align:center;">' +
            '<div style="font-size:22px;line-height:56px;font-weight:600;color:' + C.text + ';">' + score + '</div></div></div>';

        var html = '<div style="font-family:' + this.FONT + ';color:' + C.text + ';margin-top:20px;padding-top:20px;border-top:1px solid ' + C.line + ';">' +
            '<div style="display:flex;align-items:center;gap:8px;font-size:15px;line-height:20px;font-weight:600;"><span style="display:inline-block;width:20px;height:20px;">' + this.icon('sparkle', 20, C.brand) + '</span>AI quality evaluation</div>' +
            '<div style="display:flex;align-items:center;gap:16px;margin:16px 0 20px;">' + ring + '<div>' +
            '<div style="margin-bottom:4px;">' + this.badge(band[0], band[1], band[2]) + '</div>' +
            '<div style="font-size:13px;line-height:18px;font-weight:600;">' + this.esc(gr.getValue('u_quality_plan') || 'Quality evaluation') + '</div>' +
            '<div style="font-size:12px;line-height:16px;color:' + C.text2 + ';">' + (inds.length ? inds.length + ' indicators, ' + attention + ' need attention' : 'Overall score') + '</div></div></div>';

        var summary = gr.getValue('u_quality_summary');
        if (summary) html += '<div style="margin:0 0 12px;"><div style="font-size:12px;line-height:16px;font-weight:600;color:' + C.text2 + ';margin-bottom:4px;">Summary</div>' +
            '<div style="font-size:13px;line-height:20px;color:' + C.text + ';">' + this.esc(summary) + '</div></div>';

        var plan = gr.getValue('u_quality_action_plan');
        if (plan) html += '<div style="margin:0 0 16px;padding:12px 14px;border-radius:6px;background:' + C.brandBg + ';border-left:3px solid ' + C.brand + ';">' +
            '<div style="display:flex;align-items:center;gap:6px;font-size:12px;line-height:16px;font-weight:600;color:' + C.brandDark + ';margin-bottom:4px;"><span style="display:inline-block;width:16px;height:16px;">' + this.icon('lightbulb', 16, C.brandDark) + '</span>Coaching recommendation</div>' +
            '<div style="font-size:13px;line-height:20px;color:' + C.text + ';">' + this.esc(plan) + '</div></div>';

        if (inds.length) {
            var toneBy = { Normal: [C.ok, C.okBg], Warning: [C.warn, C.warnBg], Critical: [C.bad, C.badBg] };
            html += '<div style="font-size:12px;line-height:16px;font-weight:600;color:' + C.text2 + ';margin-bottom:6px;">Indicators</div>' +
                '<div style="border:1px solid ' + C.line + ';border-radius:8px;">';
            for (var i = 0; i < inds.length; i++) {
                var r = inds[i];
                var q = (r.questionInfo && r.questionInfo[0]) || {};
                var b = this.scoreBand(r.monitorScore);
                var t = toneBy[r.matchedBandLabel] || [b[1], b[2]];
                var w = Math.max(3, Math.min(100, r.monitorScore));
                html += '<div style="padding:12px 14px;' + (i ? 'border-top:1px solid ' + C.lineSoft + ';' : '') + '">' +
                    '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">' +
                    '<div style="font-size:13px;line-height:18px;font-weight:600;">' + this.esc(r.monitorName) + '</div>' + '<div>' + this.badge(this.esc(r.monitorScore), t[0], t[1]) + '</div></div>' +
                    '<div style="height:4px;margin:8px 0;border-radius:2px;background:#ececec;"><div style="width:' + w + '%;height:4px;border-radius:2px;background:' + t[0] + ';"></div></div>' +
                    '<div style="font-size:12px;line-height:18px;color:' + C.text2 + ';">' + this.esc((q.reason || q.answerText || '').replace(/^\s+|\s+$/g, '')) + '</div></div>';
            }
            html += '</div>';
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
        return this.wrap(parts.join('<div style="height:1px;margin:16px 0;background:' + this.C.line + ';"></div>'));
    },

    wrap: function (inner) {
        return '<div style="max-width:960px;border:1px solid ' + this.C.line + ';border-radius:12px;padding:20px 24px;background:#ffffff;box-shadow:0 1px 2px rgba(0,0,0,0.06);">' + inner + '</div>';
    },

    type: 'D365CCJourney'
};
