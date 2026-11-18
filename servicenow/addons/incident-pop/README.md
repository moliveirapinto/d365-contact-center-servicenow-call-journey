# Optional add-on: open the Incident (or Case) when the agent accepts a call

**Status: experimental.** Installed on an ITSM instance on 2026-11-18. The Incident creation it depends on was confirmed with real calls. Whether the record opens by itself and the banner appears has **not yet been confirmed with a real call**. Test it on your instance before you rely on it.

## Why it exists

The update set opens the matching **customer** (contact or user) only when the Dynamics 365 Contact Center Edge portal sends a `screenPop.requested` event. In a real ITSM install (2026-11-18, Service Operations Workspace, Edge panel in OpenFrame), accepted calls created the Incident in ServiceNow but no screen-pop event reached ServiceNow, so **nothing opened when the agent accepted the call**. Agents expected the new **Incident** to open.

This add-on opens that Incident (or the Case in the CSM edition) as soon as ServiceNow has it.

## How it works

1. The agent accepts the call in the panel. The flow **D365 Contact Center - Create ServiceNow case when an agent accepts a call** runs **every minute**, so the Incident and its `u_cc_call` row appear in ServiceNow **within about a minute**.
2. While the panel is open, the UI Script `d365cc_incident_pop` asks the UI Page `/d365cc_mycall.do?secs=N` every 4 seconds for the newest `u_cc_call` that already has a record (`u_case`) and was created since the panel loaded (at most the last 180 seconds).
3. When it finds one, it opens the record with OpenFrame (`openFrameAPI.show()` and `openFrameAPI.openServiceNowForm`). It also shows a banner in the panel, **"INCxxxxxxx created for this call — Open"**, which opens the record in a new tab if the automatic open did not work.
4. Each call is opened only once. The browser's `localStorage` key `d365cc_popped` remembers which calls were already opened.

`d365cc_mycall` reads the record table from the system property `d365cc.record_table`, so the same files work for the CSM edition (`sn_customerservice_case`). Only the ITSM edition has been tried.

## Limits

* **One agent per instance.** It opens the newest call created on the whole instance, not the call of the signed-in agent: `u_cc_call.u_agent` holds the Dynamics 365 agent name, which does not map to a ServiceNow user. With several agents taking calls at the same time, an agent can be shown another agent's Incident. Use it for demos and single-agent pilots, or add an agent mapping before production use.
* **Up to about a minute of delay**, set by the accept flow's one-minute recurrence.
* The record opens only while the agent has the panel loaded in ServiceNow.

## Install (about 5 minutes, admin)

1. **UI Page** (System UI → UI Pages → New): Name `d365cc_mycall`, Category `general`, Direct **false**, HTML = the content of [`d365cc_mycall.xml`](d365cc_mycall.xml). When you save, ServiceNow may ask for a role for the page's access control: choose `sn_openframe_user`, so every agent who has the panel can read it.
2. **UI Script** (System UI → UI Scripts → New): Name `d365cc_incident_pop`, Active **true**, Global **false**, UI type **All**, Script = the content of [`d365cc_incident_pop.js`](d365cc_incident_pop.js).
3. **UI Page `d365cc_edge`** (from the update set): in its HTML, add this one line right after the existing `<g:requires name="d365cc_edge_host.jsdbx"/>` line, and change nothing else:

   ```xml
   <g:requires name="d365cc_incident_pop.jsdbx"/>
   ```

   The code editor of the HTML field can add characters while you type. Click **Click to disable syntax highlighting** above the field first.
4. Open `https://<instance>/cache.do` once.
5. Check:
   * `https://<instance>/d365cc_incident_pop.jsdbx` shows the script.
   * `https://<instance>/d365cc_mycall.do?secs=60` loads. It is empty when no call arrived in the last minute.
   * `https://<instance>/sys_ui_page.do?XML&sys_id=<sys_id of d365cc_edge>` shows both `g:requires` lines.
6. Agents hard-refresh ServiceNow (Ctrl+Shift+R), open the panel and take a call.

## Uninstall

Remove the `g:requires` line from `d365cc_edge`, open `/cache.do`, then delete the UI Script `d365cc_incident_pop` and the UI Page `d365cc_mycall` (and its access control).
