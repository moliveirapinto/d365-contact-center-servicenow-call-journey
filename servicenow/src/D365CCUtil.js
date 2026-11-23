var D365CCUtil = Class.create();
D365CCUtil.prototype = {
    initialize: function () {},

    prop: function (name, fallback) {
        return gs.getProperty('d365cc.' + name, fallback || '');
    },

    // Installation mode, set at install time: 'csm' (Cases and customer contacts) or 'itsm' (Incidents and users).
    mode: function () { return this.prop('mode', 'csm'); },
    recordTable: function () { return this.prop('record_table', 'sn_customerservice_case'); },
    customerTable: function () { return this.prop('customer_table', 'customer_contact'); },
    customerField: function () { return this.prop('customer_field', 'contact'); },
    createCustomer: function () { return this.prop('create_customer', 'true') === 'true'; },

    // Link to a record in the agent interface. d365cc.record_url holds a template with {table} and {id}
    // (for example /now/sow/record/{table}/{id} for the Service Operations Workspace).
    recordPath: function (table, id) {
        var tpl = this.prop('record_url', '/now/cwf/agent/record/{table}/{id}');
        return tpl.replace('{table}', table).replace('{id}', id);
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
    titleFor: function (utcValue, channel) {
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
        return this.channelName(channel) + (this.isVoice(channel) ? ' received on ' : ' started on ') + text + ' ' + label;
    },

    // u_channel holds "Voice call" for voice and the Dynamics 365 channel name ("Live chat", "WhatsApp", "SMS"...) for messaging.
    isVoice: function (channel) {
        return !channel || /voice|call|phone/i.test(String(channel));
    },

    // Short name used in titles: "Phone call", "Chat", "WhatsApp conversation"...
    channelName: function (channel) {
        if (this.isVoice(channel)) return 'Phone call';
        if (/chat/i.test(String(channel))) return 'Chat';
        return String(channel) + ' conversation';
    },

    // Noun used in the Activity stream and resolution notes: call | chat | conversation
    noun: function (channel) {
        if (this.isVoice(channel)) return 'call';
        return /chat/i.test(String(channel)) ? 'chat' : 'conversation';
    },

    secondsBetween: function (fromValue, toValue) {
        if (!fromValue || !toValue) return '';
        var a = new GlideDateTime(fromValue).getNumericValue();
        var b = new GlideDateTime(toValue).getNumericValue();
        return Math.round((b - a) / 1000);
    },

    // Find a customer by phone (any format, the last 10 digits are compared), then e-mail, then name. Read-only.
    // table: customer table (default d365cc.customer_table). isAccount: search companies, which only have a phone and a name.
    // secure: true runs the search with the signed-in user's own access (used by the screen pop page).
    findCustomer: function (name, email, phone, table, isAccount, secure) {
        table = table || this.customerTable();
        var self = this;
        var open = function () { return secure ? new GlideRecordSecure(table) : new GlideRecord(table); };
        var digits = String(phone || '').replace(/\D/g, '');
        var tail = digits.length >= 7 ? digits.slice(-10) : '';
        var gr;
        if (tail) {
            gr = open();
            var last4 = tail.slice(-4);
            gr.addEncodedQuery(isAccount ? 'phoneENDSWITH' + last4 : 'phoneENDSWITH' + last4 + '^ORmobile_phoneENDSWITH' + last4);
            gr.setLimit(50);
            gr.query();
            while (gr.next()) {
                var nums = [gr.getValue('phone')];
                if (!isAccount) nums.push(gr.getValue('mobile_phone'));
                for (var i = 0; i < nums.length; i++) {
                    var d = String(nums[i] || '').replace(/\D/g, '');
                    if (d.length >= 7 && d.slice(-10) === tail) return gr.getUniqueValue();
                }
            }
        }
        if (email && !isAccount) {
            gr = open();
            gr.addQuery('email', email);
            gr.setLimit(1);
            gr.query();
            if (gr.next()) return gr.getUniqueValue();
        }
        var full = String(name || '').trim();
        if (full) {
            gr = open();
            if (isAccount) {
                gr.addQuery('name', full);
            } else {
                var parts = full.split(/\s+/);
                gr.addQuery('first_name', parts[0]);
                if (parts.length > 1) gr.addQuery('last_name', parts.slice(1).join(' '));
            }
            gr.setLimit(1);
            gr.query();
            if (gr.next()) return gr.getUniqueValue();
        }
        return '';
    },

    // Match a customer (CSM contact or ITSM user) with findCustomer.
    // In CSM mode a contact is created when nothing matches; in ITSM mode no user is ever created.
    findOrCreateContact: function (name, email, phone) {
        var found = this.findCustomer(name, email, phone);
        if (found) return found;
        var parts = String(name || '').trim().split(/\s+/);
        if (!parts[0] || !this.createCustomer()) return '';
        var nc = new GlideRecord(this.customerTable());
        nc.initialize();
        nc.first_name = parts[0];
        nc.last_name = parts.slice(1).join(' ') || '(caller)';
        if (email) nc.email = email;
        if (phone) nc.mobile_phone = phone;
        return nc.insert();
    },
    callPath: function (callSysId) {
        return this.recordPath('u_cc_call', callSysId);
    },

    // Case activity entry (a work note rendered as HTML by the Activity stream). kind: 'created' | 'completed'
    activityNote: function (gr, kind) {
        var j = new D365CCJourney();
        var icons = new D365CCIcons();
        var esc = function (s) { return j.esc(s); };
        var done = kind === 'completed';
        var channel = gr.getValue('u_channel');
        var voice = this.isVoice(channel);
        var head = 'Contact Center ' + this.noun(channel) + (done ? ' completed' : ' created');
        var detail;
        if (!done) {
            detail = (voice ? 'Inbound voice call' : this.channelName(channel)) + ', handled by the virtual agent';
        } else {
            var bits = [];
            var total = j.secs(gr.getValue('u_total_duration_seconds'));
            if (total) bits.push('Total ' + total);
            var talk = j.secs(gr.getValue(voice ? 'u_talk_time_seconds' : 'u_handle_time_seconds'));
            if (talk) bits.push((voice ? 'Talk ' : 'Handle ') + talk);
            if (gr.getValue('u_agent')) bits.push('Agent ' + gr.getValue('u_agent'));
            if (gr.getValue('u_customer_sentiment')) bits.push(gr.getValue('u_customer_sentiment') + ' sentiment');
            if (gr.getValue('u_quality_score')) bits.push('Quality ' + gr.getValue('u_quality_score') + ' (' + j.scoreBand(Number(gr.getValue('u_quality_score')))[0] + ')');
            detail = bits.join('  |  ');
        }
        var html = '<div style="font-family:' + j.FONT + ';">' +
            '<div style="display:flex;align-items:center;gap:8px;font-size:14px;font-weight:600;color:#242424;">' +
            '<span style="display:inline-block;width:16px;height:16px;">' + icons.img(done ? 'check' : (voice ? 'call_inbound' : 'chat'), 16, done ? '#107c10' : '#0f6cbd') + '</span>' + head + '<span style="display:none;"> - </span></div>' +
            '<div style="margin:4px 0 0 24px;font-size:13px;color:#424242;">' + esc(gr.getValue('u_title')) + '</div>' +
            (detail ? '<div style="margin:2px 0 0 24px;font-size:13px;color:#616161;">' + esc(detail) + '</div>' : '') +
            '<div style="margin:6px 0 0 24px;"><a href="/d365cc_open.do?sysparm_call=' + gr.getUniqueValue() + '" target="_blank" rel="noopener" style="font-size:13px;font-weight:600;color:#0f6cbd;text-decoration:none;">Open call journey</a></div></div>';
        return '[code]' + html + '[/code]';
    },
    type: 'D365CCUtil'
};
