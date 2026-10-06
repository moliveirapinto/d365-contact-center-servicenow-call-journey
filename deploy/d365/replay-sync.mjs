// Replays what the D365 flow does for one conversation: read it, read its evaluation, POST to ServiceNow.
// Usage: node deploy/d365/replay-sync.mjs <conversationId>
import { cfg, log } from '../lib.mjs';

const id = process.argv[2];
if (!id) throw new Error('Usage: node deploy/d365/replay-sync.mjs <conversationId>');
const token = (process.env.D365_TOKEN || '').trim();
const H = { Authorization: `Bearer ${token}`, Accept: 'application/json', 'OData-Version': '4.0', Prefer: 'odata.include-annotations="*"' };
const base = `${cfg.d365Url}/api/data/v9.2`;
const FV = '@OData.Community.Display.V1.FormattedValue';

const conv = await (await fetch(`${base}/msdyn_ocliveworkitems(${id})?$select=msdyn_createdon,msdyn_activeagentassignedon,msdyn_closedon,msdyn_wrapupinitiatedon,msdyn_conversationtalktimeinseconds,msdyn_conversationfirstwaittimeinseconds,msdyn_conversationhandletimeinseconds,msdyn_customersentimentlabel,msdyn_channelconnectionid,msdyn_copilotengaged,_msdyn_cdsqueueid_value,_msdyn_activeagentid_value`, { headers: H })).json();
if (conv.error) throw new Error(conv.error.message);
const evals = (await (await fetch(`${base}/msdyn_evaluationhistories?$select=msdyn_evaluationscore,msdyn_responsejson,createdon&$filter=msdyn_ocliveworkitemid eq '${id}'&$orderby=createdon desc&$top=1`, { headers: H })).json()).value || [];
const ev = evals[0];
const j = (() => { try { return JSON.parse(ev?.msdyn_responsejson || '{}'); } catch { return {}; } })();

const payload = {
    conversation_id: id,
    status: 'Completed',
    call_received: conv.msdyn_createdon,
    agent_connected: conv.msdyn_activeagentassignedon,
    call_ended: conv.msdyn_closedon || conv.msdyn_wrapupinitiatedon || new Date().toISOString(),
    queue: conv['_msdyn_cdsqueueid_value' + FV],
    agent: conv['_msdyn_activeagentid_value' + FV],
    customer_sentiment: conv['msdyn_customersentimentlabel' + FV],
    handled_by_virtual_agent: conv.msdyn_copilotengaged === true,
    talk_time_seconds: conv.msdyn_conversationtalktimeinseconds,
    wait_time_seconds: conv.msdyn_conversationfirstwaittimeinseconds,
    handle_time_seconds: conv.msdyn_conversationhandletimeinseconds,
    called_number: conv.msdyn_channelconnectionid,
    quality_score: ev?.msdyn_evaluationscore,
    quality_evaluated_at: ev?.createdon,
    quality_evaluation_json: ev?.msdyn_responsejson,
    quality_plan: j.action_name,
    quality_summary: j.overall_summary,
    quality_action_plan: j.action_plan
};
log('payload: ' + JSON.stringify({ ...payload, quality_evaluation_json: payload.quality_evaluation_json ? `<${payload.quality_evaluation_json.length} chars>` : null }, null, 1));

const user = process.env.SN_INTEGRATION_USER || 'd365cc.integration';
const res = await fetch(`https://${cfg.instance}/api/global/d365cc/call`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${user}:${process.env.SN_INTEGRATION_PASS}`).toString('base64'), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload)
});
log(`ServiceNow -> ${res.status} ${await res.text()}`);
