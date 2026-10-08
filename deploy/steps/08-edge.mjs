import { upsert, log } from '../lib.mjs';

// The new Dynamics 365 Contact Center Edge desktop (Pulse portal) only starts when its parent frame answers
// its postMessage handshake (d365edge:ping -> d365edge:init). In Salesforce Microsoft's d365EdgeContainer LWC
// does that; here a small ServiceNow page plays the same role and OpenFrame shows that page.
const HOST_SCRIPT = `(function () {
    var VERSION = 1;
    var root = document.getElementById('d365cc_edge');
    if (!root) return;
    var edgeUrl = root.getAttribute('data-edge-url') || 'https://portal.us.contactcenterai.powerplatform.com/experience/agent';
    var orgUrl = (root.getAttribute('data-org-url') || '').replace(/\\/+$/, '');
    var layout = root.getAttribute('data-layout') || 'embedded';
    var verbose = root.getAttribute('data-verbose') === 'true';
    var status = document.getElementById('d365cc_status');
    var iframe = null;
    var lockedOrigin = null;
    var heartbeat = null;
    var pending = {};

    function uuid() {
        if (window.crypto) { if (window.crypto.randomUUID) return window.crypto.randomUUID(); }
        return String(Date.now()) + '-' + String(Math.random()).slice(2);
    }
    function setStatus(t) { if (status) status.textContent = t; }
    function post(msg) {
        if (!iframe) return;
        if (!iframe.contentWindow) return;
        var target = lockedOrigin || new URL(iframe.src).origin;
        if (verbose) console.log('[D365CC Edge] ->', target, msg);
        iframe.contentWindow.postMessage(msg, target);
    }
    function envelope(type, extra) {
        var m = { type: type, version: VERSION, callId: uuid(), timestamp: Date.now() };
        for (var k in extra) { if (Object.prototype.hasOwnProperty.call(extra, k)) m[k] = extra[k]; }
        return m;
    }
    function sendInit() {
        post(envelope('d365edge:init', {
            config: { orgUrl: orgUrl, authMode: 'interactive', layout: layout, crmAdapter: 'servicenow', crmCapabilities: ['screenPop'] },
            theme: { mode: 'light', direction: 'ltr' }
        }));
    }
    function request(type, body) {
        return new Promise(function (resolve, reject) {
            var m = envelope(type, body);
            pending[m.callId] = { resolve: resolve, reject: reject, timer: setTimeout(function () {
                delete pending[m.callId];
                reject(new Error(type + ' timed out'));
            }, 10000) };
            post(m);
        });
    }

    // Screen pop: open the matching ServiceNow customer (by phone, e-mail or name) in the Workspace.
    function screenPop(payload) {
        if (!payload) return;
        var type = String(payload.entityType || '').toLowerCase();
        var id = payload.entityId;
        if (!id) return;
        var set = type === 'account' ? 'accounts' : 'contacts';
        var select = type === 'account' ? '?$select=name,telephone1,emailaddress1' : '?$select=fullname,mobilephone,telephone1,emailaddress1';
        request('d365edge:query', { query: 'retrieveRecord', params: { entitySet: set, id: id, options: select } })
            .catch(function () { return {}; })
            .then(function (rec) {
                rec = rec || {};
                var q = [];
                var phone = rec.mobilephone || rec.telephone1;
                if (phone) q.push('phoneLIKE' + String(phone).replace(/[^0-9]/g, '').slice(-10) + '^ORmobile_phoneLIKE' + String(phone).replace(/[^0-9]/g, '').slice(-10));
                if (rec.emailaddress1) q.push('email=' + rec.emailaddress1);
                var name = rec.fullname || rec.name || payload.entityName;
                if (name) q.push('name=' + name);
                if (!q.length) return;
                var table = type === 'account' ? 'customer_account' : 'customer_contact';
                var tryNext = function (i) {
                    if (i >= q.length) return;
                    fetch('/api/now/table/' + table + '?sysparm_limit=1&sysparm_fields=sys_id&sysparm_query=' + encodeURIComponent(q[i]), {
                        headers: { Accept: 'application/json', 'X-UserToken': window.g_ck || '' }, credentials: 'same-origin'
                    }).then(function (r) { return r.json(); }).then(function (j) {
                        var hit = j.result;
                        if (hit) { if (hit.length) { openRecord(table, hit[0].sys_id); return; } }
                        tryNext(i + 1);
                    }).catch(function () { tryNext(i + 1); });
                };
                tryNext(0);
            });
    }
    var ofReady = false;
    if (window.openFrameAPI) {
        try { window.openFrameAPI.init({}, function () { ofReady = true; }, function () { ofReady = false; }); } catch (e) { }
    }
    function showPanel() {
        if (!ofReady) return;
        try { window.openFrameAPI.show(); } catch (e) { }
    }
    function openRecord(table, sysId) {
        if (ofReady) {
            try { window.openFrameAPI.openServiceNowForm({ entity: table, query: 'sys_id=' + sysId }); return; } catch (e) { }
        }
        try { window.top.location.href = '/now/cwf/agent/record/' + table + '/' + sysId; } catch (e) { }
    }

    window.addEventListener('message', function (e) {
        var d = e.data;
        if (!d) return;
        if (typeof d !== 'object') return;
        if (typeof d.type !== 'string') return;
        if (d.type.indexOf('d365edge:') !== 0) return;
        if (d.version !== VERSION) return;
        if (lockedOrigin === null) {
            if (!iframe) return;
            if (e.source !== iframe.contentWindow) return;
            lockedOrigin = e.origin;
        } else if (e.origin !== lockedOrigin) {
            return;
        }
        if (verbose) console.log('[D365CC Edge] <-', e.origin, d);
        switch (d.type) {
            case 'd365edge:ping': sendInit(); break;
            case 'd365edge:ready':
                setStatus('');
                if (heartbeat) clearInterval(heartbeat);
                heartbeat = setInterval(function () { post(envelope('d365edge:heartbeat', {})); }, 30000);
                break;
            case 'd365edge:heartbeat': post({ type: 'd365edge:heartbeat', version: VERSION, callId: d.callId, timestamp: Date.now() }); break;
            case 'd365edge:event':
                if (d.event === 'conversation.invited') showPanel();
                if (d.event === 'screenPop.requested') screenPop(d.data);
                break;
            case 'd365edge:command:response':
            case 'd365edge:query:response':
                var p = pending[d.callId];
                if (!p) break;
                clearTimeout(p.timer);
                delete pending[d.callId];
                if (d.success === false || d.error) p.reject(new Error((d.error && d.error.message) || 'Unknown error'));
                else p.resolve(d.data);
                break;
            case 'd365edge:error': setStatus('Error: ' + ((d.error && d.error.message) || 'unknown')); break;
            default: break;
        }
    });

    if (!orgUrl) { setStatus('Set the system property d365cc.org_url to your Dynamics 365 URL.'); return; }
    var url = new URL(edgeUrl);
    url.searchParams.set('orgUrl', orgUrl);
    url.searchParams.set('embedded', 'true');
    iframe = document.createElement('iframe');
    iframe.src = url.toString();
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-forms allow-popups-to-escape-sandbox allow-modals allow-downloads');
    iframe.setAttribute('allow', 'microphone; camera; autoplay; clipboard-read; clipboard-write; display-capture; storage-access');
    iframe.title = 'Dynamics 365 Contact Center';
    root.appendChild(iframe);
    // The portal pings first; send init once on load as well in case the first ping arrived before we listened.
    iframe.addEventListener('load', function () { setTimeout(sendInit, 300); });
})();`;

const PAGE = `<?xml version="1.0" encoding="utf-8" ?>
<j:jelly trim="false" xmlns:j="jelly:core" xmlns:g="glide" xmlns:j2="null" xmlns:g2="null">
<g:evaluate var="jvar_org" jelly="true">String(gs.getProperty('d365cc.org_url', '') || '');</g:evaluate>
<g:evaluate var="jvar_edge" jelly="true">String(gs.getProperty('d365cc.edge_url', 'https://portal.us.contactcenterai.powerplatform.com/experience/agent') || '');</g:evaluate>
<g:evaluate var="jvar_layout" jelly="true">String(gs.getProperty('d365cc.edge_layout', 'embedded') || 'embedded');</g:evaluate>
<html>
<head>
<title>Dynamics 365 Contact Center</title>
<style>
html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; background: #fff; font-family: 'Source Sans Pro', Helvetica, Arial, sans-serif; }
#d365cc_edge { position: absolute; top: 0; left: 0; right: 0; bottom: 0; }
#d365cc_edge iframe { width: 100%; height: 100%; border: 0; display: block; }
#d365cc_status { position: absolute; top: 8px; left: 12px; right: 12px; font-size: 13px; color: #555; pointer-events: none; }
</style>
<script src="/scripts/openframe/latest/openFrameAPI.min.js"></script>
</head>
<body>
<div id="d365cc_status">Loading Dynamics 365 Contact Center...</div>
<div id="d365cc_edge" data-org-url="\${jvar_org}" data-edge-url="\${jvar_edge}" data-layout="\${jvar_layout}"></div>
<script src="/d365cc_edge_host.jsdbx"></script>
</body>
</html>
</j:jelly>`;

export default async function edge() {
    await upsert('sys_ui_script', 'name=d365cc_edge_host', {
        name: 'd365cc_edge_host', script: HOST_SCRIPT, global: 'false', active: 'true', ui_type: '10',
        description: 'Hosts the Dynamics 365 Contact Center Edge desktop and answers its postMessage handshake (used by the d365cc_edge page).'
    });
    await upsert('sys_ui_page', 'name=d365cc_edge', {
        name: 'd365cc_edge', html: PAGE.replace(/^<\?xml[^>]*\?>\s*/, ''), direct: 'true', category: 'general',
        description: 'Dynamics 365 Contact Center Edge softphone host for OpenFrame.'
    });
    log('  edge host page ready: /d365cc_edge.do');
}
