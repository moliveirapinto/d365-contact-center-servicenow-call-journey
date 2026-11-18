# Field notes: a real install, problems and fixes

These notes come from installing **v1.1.0 (ITSM edition)** on a ServiceNow instance (non-production, agents in the **Service Operations Workspace**) connected to an existing Dynamics 365 Contact Center environment, on **2026-11-18**. An AI assistant did the work in the administrator's browser. Real inbound calls were used to test it. Every item below happened during that install, and the README and the install prompt now cover each one.

| # | What happened | Cause | Fix (now in the README / prompt) |
|---|---|---|---|
| 1 | The assistant could not upload the update set XML or the solution zip | Browser automation usually cannot pick a file on the user's computer | The administrator does just that click (choose the file, Upload). The assistant previews, commits and verifies. |
| 2 | The panel showed **another Dynamics 365 org** (an old demo environment) | An older OpenFrame configuration (*Dynamics 365 Contact Center Embed*, widget URL with another `dynamicsUrl`) was still **active** next to the new *Dynamics 365 Contact Center* | Before testing, list **OpenFrame → Configurations**. Deactivate (do not delete) older Dynamics 365 configurations, open `/cache.do`, then hard-refresh. |
| 3 | Agent sign-in failed with **AADSTS700003 "Your organization has deleted this device"** | Windows single sign-on on the agent's PC offered a work account whose device registration was deleted in that tenant. It is not caused by this package. | In Edge, turn off **Settings → Profiles → Profile preferences → Allow single sign-on for work or school sites using this profile**, or remove the stale account under **Windows Settings → Accounts → Access work or school**, or use another browser profile. Then sign in again. |
| 4 | Another agent got **HTTP 400 "Request Too Long"** at sign-in | Too many Microsoft cookies | Clear the cookies for `microsoftonline.com`, `dynamics.com` and `powerplatform.com`, or use an InPrivate window. |
| 5 | The browser console showed `[Violation] Permissions policy violation: unload is not allowed` and a 404 on `.../cceweb/config/<org>/settings.json` | Messages from the ServiceNow and Microsoft pages themselves | On their own these do not stop the panel. Look for the actual sign-in error instead (items 3 and 4). |
| 6 | The Incident was created, but **nothing opened** in ServiceNow when the agent accepted the call | The package opens the matching **customer** only on the Edge portal's `screenPop.requested` event, and no such event reached ServiceNow with real calls. The Incident itself appears up to a minute after the accept, because the accept flow runs every minute. | Optional add-on [`servicenow/addons/incident-pop`](../servicenow/addons/incident-pop) opens the new Incident (or Case) and shows an **Open** banner in the panel. It is experimental and suits one agent per instance; see its README. |
| 7 | The **Recording & transcript** link contained `REPLACE-WITH-YOUR-D365-APP-ID` and failed | `d365cc.app_id` was left at its placeholder. The README called it optional. | Set `d365cc.app_id` to the `appmoduleid` of **Copilot Service workspace** (`uniquename` `msdyn_CustomerServiceWorkspace`), found with `https://<org>/api/data/v9.2/appmodules?$select=name,uniquename,appmoduleid` while signed in to Dynamics 365. The link is built when the call is displayed, so past calls are fixed too. |
| 8 | "I can't see the call journey" in the Service Operations Workspace | In that workspace, **Open call journey** is in the record's **⋯ (More actions)** menu, not a header button. The Call Journey card is at the **bottom** of the call form that opens as a sub tab. | Documented in Test it, Troubleshooting and the prompt's end-to-end check. |
| 9 | Times in the journey card were **3 hours off** (1:43 PM for a 4:43 PM ET call) | The card uses the agent's **ServiceNow user time zone**, which was Pacific. `d365cc.time_zone` only affects call titles. | Set each agent's time zone in their ServiceNow user profile. The prompt now checks it. |
| 10 | **Scripts - Background** answered "not authorized", and elevating offered no `security_admin` | Instance security policy | Use the forms and list views. Nothing in the install needs a background script. |
| 11 | ServiceNow signed the session out several times | Instance session timeout | The assistant asks the administrator to sign in again and continues where it stopped. |

## What was confirmed with real calls

* Accepting a call created the **Incident** (caller set when a ServiceNow user matched by phone) and a `u_cc_call` row, within about a minute.
* At call end the call became **Completed** with timings, and one **Contact Center call completed** entry appeared in the Incident activity.
* **⋯ → Open call journey** in the Service Operations Workspace opened the call as a sub tab with the Call Journey card. After `d365cc.app_id` was set, **Recording & transcript** opened the Copilot Service workspace conversation with the recording player.

## Still open

* The Edge portal's `screenPop.requested` event was not observed with real calls (item 6).
* The incident-pop add-on's automatic open was not yet confirmed with a real call.
* Multi-agent use of the add-on needs a mapping from the Dynamics 365 agent to the ServiceNow user.
