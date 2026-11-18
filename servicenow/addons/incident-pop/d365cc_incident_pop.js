(function () {
    // Incident pop for the Dynamics 365 Contact Center panel (added 2026-11-18).
    // After the agent accepts a call, the Dynamics 365 flow creates the Incident in ServiceNow. This script asks
    // ServiceNow every 4 seconds for the Incident of the newest Contact Center call created since the panel loaded,
    // opens it once in the main ServiceNow area, and shows an "Open" button in the panel.
    if (!document.getElementById('d365cc_edge')) return;
    var recordUrl = document.getElementById('d365cc_edge').getAttribute('data-record-url') || '/now/nav/ui/classic/params/target/{table}.do%3Fsys_id%3D{id}';
    var pageLoadTs = Date.now();
    var popped = {};
    try { popped = JSON.parse(window.localStorage.getItem('d365cc_popped') || '{}') || {}; } catch (e) { popped = {}; }
    function markPopped(id) {
        popped[id] = Date.now();
        try {
            var keys = Object.keys(popped);
            if (keys.length > 50) {
                keys.sort(function (a, b) { return popped[a] - popped[b]; });
                for (var i = 0; i < keys.length - 50; i++) delete popped[keys[i]];
            }
            window.localStorage.setItem('d365cc_popped', JSON.stringify(popped));
        } catch (e) { }
    }
    function openRecord(table, sysId, fromClick) {
        if (window.openFrameAPI) {
            try { window.openFrameAPI.show(); } catch (e) { }
            try { window.openFrameAPI.openServiceNowForm({ entity: table, query: 'sys_id=' + sysId }); return; } catch (e) { console.warn('[D365CC] open failed', e); }
        }
        if (fromClick) { try { window.open(recordUrl.replace('{table}', table).replace('{id}', sysId), '_blank'); } catch (e) { } }
    }
    var banner = null;
    function showBanner(table, sysId, number) {
        try {
            if (!banner) {
                banner = document.createElement('div');
                banner.setAttribute('role', 'status');
                banner.style.cssText = 'position:absolute;left:8px;right:8px;bottom:8px;z-index:10;background:#032d60;color:#fff;border-radius:6px;padding:8px 10px;font-size:13px;display:flex;align-items:center;gap:8px;box-shadow:0 2px 8px rgba(0,0,0,.3);';
                document.body.appendChild(banner);
            }
            while (banner.firstChild) banner.removeChild(banner.firstChild);
            var t = document.createElement('span');
            t.style.flex = '1';
            t.textContent = (number || 'Incident') + ' created for this call';
            var b = document.createElement('button');
            b.textContent = 'Open';
            b.style.cssText = 'background:#fff;color:#032d60;border:0;border-radius:4px;padding:4px 12px;cursor:pointer;font-weight:600;';
            b.onclick = function () { openRecord(table, sysId, true); };
            var x = document.createElement('button');
            x.textContent = 'x';
            x.setAttribute('aria-label', 'Dismiss');
            x.style.cssText = 'background:transparent;color:#fff;border:0;font-size:14px;cursor:pointer;';
            x.onclick = function () { banner.style.display = 'none'; };
            banner.appendChild(t); banner.appendChild(b); banner.appendChild(x);
            banner.style.display = 'flex';
            setTimeout(function () { banner.style.display = 'none'; }, 300000);
        } catch (e) { }
    }
    var busy = false;
    function poll() {
        if (busy) return;
        var secs = Math.ceil((Date.now() - pageLoadTs + 5000) / 1000);
        if (secs > 180) secs = 180;
        busy = true;
        fetch('/d365cc_mycall.do?secs=' + secs, { credentials: 'same-origin' }).then(function (r) { return r.text(); }).then(function (html) {
            busy = false;
            var m = html.match(/id="d365cc_inc">([a-z0-9_]+)\|([0-9a-f]{32})\|([^|<]*)\|([0-9a-f]{32})</);
            if (!m) return;
            if (popped[m[4]]) return;
            markPopped(m[4]);
            console.info('[D365CC] Incident pop', m[3]);
            openRecord(m[1], m[2], false);
            showBanner(m[1], m[2], m[3]);
        }).catch(function () { busy = false; });
    }
    setInterval(poll, 4000);
})();
