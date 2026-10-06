# Dynamics 365 Contact Center × ServiceNow — Call Journey

**Your agents work in ServiceNow. Your calls run on Dynamics 365 Contact Center.**
This is the ServiceNow port of the [Salesforce Call Journey](https://github.com/moliveirapinto/d365-contact-center-salesforce-call-journey): every phone call shows up on the ServiceNow Case with its full story, and one click opens the Dynamics 365 recording, transcript and AI quality evaluation **inside ServiceNow**.

Built and tested on the **CSM/FSM Configurable Workspace** (Zurich) and the classic UI.

## Feature parity with the Salesforce version

| Salesforce | ServiceNow (this repo) |
|---|---|
| `Contact_Center_Call__c` object (30 fields) | Table **`u_cc_call`** ("Contact Center Call"), same fields |
| Case fields `D365_Conversation_Id__c`, `D365_Call_Recording__c` | `sn_customerservice_case.u_d365_conversation_id`, `u_d365_call_recording`, `u_call_journey` |
| Custom Setting *D365 Contact Center Settings* | System properties **`d365cc.org_url`, `d365cc.app_id`, `d365cc.time_zone`, `d365cc.time_zone_label`** |
| Flow *Create Call from IVR case* | Business Rule **D365CC – Create call from IVR case** (try/catch: can never block Case creation) |
| Formula fields (duration, VA time, URL, title) | Business Rule **D365CC – Calculate call fields** + calculated fields |
| `callTimeline` LWC (Call Journey card + quality evaluation) | Script Include **`D365CCJourney`**, rendered by calculated HTML fields on the Call and the Case |
| `callRecordingModal` LWC | UI Page **`d365cc_recording`** + UI Actions **Play recording / Transcript / Play call recording** (Workspace + classic) |
| Trusted URL | Not needed: ServiceNow does not block `*.dynamics.com` framing, and D365 allows ServiceNow |
| D365 sync flow → Salesforce REST PATCH | Scripted REST **`POST /api/global/d365cc/call`** (upsert by conversation ID) + D365 flow |
| D365 CTI widget in the Salesforce console | **OpenFrame** configuration (Microsoft's documented ServiceNow setup) |
| Call Review app + evaluation-pane fix in D365 | Unchanged — reuse the same D365 app and web resource |

## Data model (same as Salesforce)

One **Case** has many **calls**. Calls are not stored on the Case: each call is its own row in `u_cc_call` (the equivalent of `Contact_Center_Call__c`), related to the Case (`u_case`) and the customer (`u_contact`) the same way Salesforce relates it through `Case__c` and `Contact__c`.

```mermaid
erDiagram
    CASE ||--o{ U_CC_CALL : has
    CUSTOMER_CONTACT ||--o{ U_CC_CALL : has
    U_CC_CALL { string u_conversation_id UK }
    CASE { string u_d365_conversation_id }
```n
* `u_conversation_id` (the D365 conversation) is unique per call: it is the key the D365 sync upserts on.
* `sn_customerservice_case.u_d365_conversation_id` only holds the conversation the IVR stamped on the Case when it created it, as in Salesforce. Further calls link to the Case by being related to it.
* All 30 Salesforce fields exist on `u_cc_call` (plus the calculated journey/recording fields).

## What the agent sees

* **Case Activity stream** (Workspace): every call posts entries on the Case, like the Salesforce case feed: **📞 Contact Center Call created** when the IVR opens the Case and **📞 Contact Center Call completed** (total, talk, agent, sentiment, quality score) when D365 reports the call ended. Click **Open call journey** to open the call. The Case form itself is left untouched.
* **Contact Center Call** record (the page the link opens): see below. A *Play call recording* action on the Case ⋯ menu opens one pop-up with a tab per call.
* **Classic UI**: a *Contact Center Calls* related list on the Case and on the Customer Contact.
* **Contact Center Call**: the same card plus the **AI quality evaluation** (score, band, summary, coaching recommendation, every indicator with its reasoning). **Play recording** and **Transcript** buttons open the D365 conversation in a full-screen pop-up (audio player, waveform, transcript, quality trendline, evaluation side pane).
* **Softphone**: the Dynamics 365 Contact Center conversation widget in the Workspace top bar.

## How it works

```mermaid
sequenceDiagram
    autonumber
    actor Caller
    participant IVR as Copilot Studio IVR
    participant SN as ServiceNow
    participant D365 as Dynamics 365 Contact Center
    Caller->>IVR: Calls
    IVR->>SN: Creates Case (+ u_d365_conversation_id)
    SN->>SN: Business Rule creates the Contact Center Call
    IVR->>D365: Escalates to a human agent
    Note over D365: Call ends: recording, transcript, AI evaluation
    D365->>SN: Flow POSTs /api/global/d365cc/call (upsert by conversation ID)
    SN->>SN: Calculates duration, VA time, journey card
    SN->>D365: ▶ Play recording opens the conversation in a pop-up
```

The sync is an **upsert**, so it does not matter whether the Case or the call-ended event arrives first: you always end up with exactly one call record linked to the Case.

## Install

Requires Node 18+.

```powershell
copy .env.example .env.local     # fill in your instance + D365 URL
node deploy/deploy.mjs           # schema, logic, UI, widget, REST API
```

| Step | Script | Does |
|---|---|---|
| 1 | `deploy/steps/01-schema.mjs` | Table, columns, choices, Case fields, `d365cc.*` settings |
| 2 | `deploy/steps/02-logic.mjs` | Script Includes, Business Rules, calculated fields |
| 3 | `deploy/steps/03-ui.mjs` | UI Page, UI Actions, form layouts (classic + Workspace) |
| 4 | `deploy/steps/04-security.mjs` | OpenFrame (D365 widget) |
| 5 | `deploy/steps/05-rest.mjs` | Scripted REST API for the D365 sync |

All steps are idempotent: run them as often as you like. Run a subset with `node deploy/deploy.mjs 03-ui`.

### Dynamics 365 side

1. **Integration user.** Create a ServiceNow user (e.g. `d365cc.integration`, *web service access only*) with the `sn_customerservice_agent` role. Set its password **server-side** (a Background Script or UI): setting `user_password` through the Table API stores it in clear text and authentication will fail.
2. **Sync flow.** With a Dataverse token and the integration password in the environment:
   ```powershell
   $env:D365_TOKEN = '<dataverse token>'
   $env:SN_INTEGRATION_PASS = '<password>'
   node deploy/d365/create-flow.mjs
   ```
   Set `D365_DATAVERSE_CONNREF` to the logical name of a Dataverse connection reference in your environment (default `new_d365cc_dataverse`). This creates *D365 Contact Center – Sync ended calls to ServiceNow* (trigger: voice conversation ends → read conversation → read quality evaluation → HTTP POST).
3. **Replay a past call** to test without placing one:
   `node deploy/d365/replay-sync.mjs <conversationId>`
4. **Widget.** Copilot Service admin center → *Your default contact center* → **Conversation widget** → copy the *Embeddable conversation widget URL* into `D365_WIDGET_URL` (the default is derived from your D365 URL) and run `deploy 04-security`.
5. **Copilot Studio.** Same as the Salesforce guide, but write `Global.msdyn_ConversationId` into the ServiceNow Case field `u_d365_conversation_id` (ServiceNow connector → *Create record* on `sn_customerservice_case`).

## Notes and limits

* **Time zones.** Titles use `d365cc.time_zone` (IANA name, e.g. `America/New_York`); the journey card shows times in each viewer's own ServiceNow time zone.
* **Secrets.** The sync flow stores the integration credentials in the flow definition. For production, move them to an environment variable backed by Key Vault.
* **Workspace related list.** The Workspace tab strip (SLAs, Tasks, Emails…) is configured in UI Builder, not by related-list records, so add a *Contact Center Calls* tab there by hand if you want one; the Call Journey section already lists all calls.
* **Workspace HTML fields** render in a fixed-height editor frame; the `editor.height` dictionary attribute on the journey fields sizes them (640 px on the Call, 560 px on the Case).
* **Lab instances** from ServiceNow University expire (about 5 days, extendable) and cannot be shared; a Personal Developer Instance does not expire the same way. Re-run the deploy script on the new instance.
* This is a community sample, not an official Microsoft or ServiceNow product, and is not supported by either company. Test on a non-production instance first.
