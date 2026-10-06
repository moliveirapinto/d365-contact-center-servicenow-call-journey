var D365CCUtil = Class.create();
D365CCUtil.prototype = {
    initialize: function () {},

    prop: function (name, fallback) {
        return gs.getProperty('d365cc.' + name, fallback || '');
    },

    orgUrl: function () {
        return String(this.prop('org_url') || '').replace(/\/+$/, '');
    },

    // Build a link to the Dynamics 365 conversation. embedded=true adds navbar=off for the pop-up.
    conversationUrl: function (conversationId, embedded) {
        var org = this.orgUrl();
        if (!conversationId || !org) return '';
        var app = this.prop('app_id');
        return org + '/main.aspx?' + (app ? 'appid=' + app + '&' : '') + (embedded ? 'navbar=off&' : '') +
            'pagetype=entityrecord&etn=msdyn_ocliveworkitem&id=' + conversationId;
    },

    // "Phone call received on Tue, Oct 6 · 1:30 PM ET" in the time zone configured in d365cc.time_zone.
    titleFor: function (utcValue) {
        var tzName = this.prop('time_zone', 'UTC');
        var label = this.prop('time_zone_label');
        var millis = new GlideDateTime(utcValue || new GlideDateTime().getValue()).getNumericValue();
        var tz = Packages.java.util.TimeZone.getTimeZone(tzName);
        var fmt = new Packages.java.text.SimpleDateFormat("EEE, MMM d '\u00b7' h:mm a");
        fmt.setTimeZone(tz);
        var text = String(fmt.format(new Packages.java.util.Date(millis)));
        if (!label) {
            var off = tz.getOffset(millis) / 3600000;
            label = 'UTC' + (off === 0 ? '' : (off > 0 ? '+' : '') + off);
        }
        return 'Phone call received on ' + text + ' ' + label;
    },

    secondsBetween: function (fromValue, toValue) {
        if (!fromValue || !toValue) return '';
        var a = new GlideDateTime(fromValue).getNumericValue();
        var b = new GlideDateTime(toValue).getNumericValue();
        return Math.round((b - a) / 1000);
    },

    // Path that opens the call (its Call Journey card, recording and evaluation) in the CSM/FSM Configurable Workspace.
    callPath: function (callSysId) {
        return '/now/cwf/agent/record/u_cc_call/' + callSysId;
    },

    // Case activity entry (a work note rendered as HTML by the Activity stream). kind: 'created' | 'completed'
    activityNote: function (gr, kind) {
        var j = new D365CCJourney();
        var icons = new D365CCIcons();
        var esc = function (s) { return j.esc(s); };
        var done = kind === 'completed';
        var head = done ? 'Contact Center call completed' : 'Contact Center call created';
        var detail;
        if (!done) {
            detail = 'Inbound voice call, handled by the virtual agent';
        } else {
            var bits = [];
            var total = j.secs(gr.getValue('u_total_duration_seconds'));
            if (total) bits.push('Total ' + total);
            var talk = j.secs(gr.getValue('u_talk_time_seconds'));
            if (talk) bits.push('Talk ' + talk);
            if (gr.getValue('u_agent')) bits.push('Agent ' + gr.getValue('u_agent'));
            if (gr.getValue('u_customer_sentiment')) bits.push(gr.getValue('u_customer_sentiment') + ' sentiment');
            if (gr.getValue('u_quality_score')) bits.push('Quality ' + gr.getValue('u_quality_score') + ' (' + j.scoreBand(Number(gr.getValue('u_quality_score')))[0] + ')');
            detail = bits.join('  |  ');
        }
        var html = '<div style="font-family:' + j.FONT + ';">' +
            '<div style="display:flex;align-items:center;gap:8px;font-size:14px;font-weight:600;color:#242424;">' +
            '<span style="display:inline-block;width:16px;height:16px;">' + icons.img(done ? 'check' : 'call_inbound', 16, done ? '#107c10' : '#0f6cbd') + '</span>' + head + '<span style="display:none;"> - </span></div>' +
            '<div style="margin:4px 0 0 24px;font-size:13px;color:#424242;">' + esc(gr.getValue('u_title')) + '</div>' +
            (detail ? '<div style="margin:2px 0 0 24px;font-size:13px;color:#616161;">' + esc(detail) + '</div>' : '') +
            '<div style="margin:6px 0 0 24px;"><a href="' + this.callPath(gr.getUniqueValue()) + '" target="_blank" rel="noopener" style="font-size:13px;font-weight:600;color:#0f6cbd;text-decoration:none;">Open call journey</a></div></div>';
        return '[code]' + html + '[/code]';
    },
    type: 'D365CCUtil'
};
