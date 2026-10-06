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

    type: 'D365CCUtil'
};
