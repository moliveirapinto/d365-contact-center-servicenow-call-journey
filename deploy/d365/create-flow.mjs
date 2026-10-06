// Builds the D365 -> ServiceNow sync flow definition (same trigger/reads as the Salesforce flow, HTTP POST at the end).
// Usage: node deploy/d365/create-flow.mjs   (needs D365_TOKEN, SN_INTEGRATION_PASS and .env.local)
import fs from 'node:fs';
import { cfg, log } from '../lib.mjs';

const org = cfg.d365Url;
const token = (process.env.D365_TOKEN || '').trim();
if (!token) throw new Error('Set D365_TOKEN to a Dataverse access token for ' + org);
if (!process.env.SN_INTEGRATION_PASS) throw new Error('Set SN_INTEGRATION_PASS (the ServiceNow integration user password).');

const FLOW_NAME = 'D365 Contact Center - Sync ended calls to ServiceNow';
// Logical name of a Dataverse connection reference that exists in your environment (see README).
const dataverseRef = process.env.D365_DATAVERSE_CONNREF || 'new_d365cc_dataverse';

const eval0 = "first(outputs('Get_quality_evaluation')?['body/value'])";
const json0 = `json(coalesce(${eval0}?['msdyn_responsejson'], '{}'))`;
const CDS = { connectionName: 'shared_commondataserviceforapps', apiId: '/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps' };

const definition = {
    $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
    contentVersion: '1.0.0.0',
    parameters: {
        $connections: { defaultValue: {}, type: 'Object' },
        $authentication: { defaultValue: {}, type: 'SecureObject' }
    },
    triggers: {
        When_a_voice_conversation_ends: {
            type: 'OpenApiConnectionWebhook',
            inputs: {
                host: { ...CDS, operationId: 'SubscribeWebhookTrigger' },
                parameters: {
                    'subscriptionRequest/message': 3,
                    'subscriptionRequest/entityname': 'msdyn_ocliveworkitem',
                    'subscriptionRequest/scope': 4,
                    'subscriptionRequest/filteringattributes': 'statuscode',
                    'subscriptionRequest/filterexpression': '(statuscode eq 4 or statuscode eq 5)'
                },
                authentication: "@parameters('$authentication')"
            }
        }
    },
    actions: {
        Get_conversation: {
            runAfter: {},
            type: 'OpenApiConnection',
            inputs: {
                host: { ...CDS, operationId: 'GetItem' },
                parameters: {
                    entityName: 'msdyn_ocliveworkitems',
                    recordId: "@triggerOutputs()?['body/activityid']",
                    $select: 'msdyn_createdon,msdyn_activeagentassignedon,msdyn_closedon,msdyn_wrapupinitiatedon,msdyn_conversationtalktimeinseconds,msdyn_conversationfirstwaittimeinseconds,msdyn_conversationhandletimeinseconds,msdyn_customersentimentlabel,msdyn_channelconnectionid,msdyn_copilotengaged,_msdyn_cdsqueueid_value,_msdyn_activeagentid_value'
                },
                authentication: "@parameters('$authentication')"
            }
        },
        Get_quality_evaluation: {
            runAfter: { Get_conversation: ['Succeeded'] },
            type: 'OpenApiConnection',
            inputs: {
                host: { ...CDS, operationId: 'ListRecords' },
                parameters: {
                    entityName: 'msdyn_evaluationhistories',
                    $select: 'msdyn_evaluationscore,msdyn_responsejson,createdon',
                    $filter: "msdyn_ocliveworkitemid eq '@{triggerOutputs()?['body/activityid']}'",
                    $orderby: 'createdon desc',
                    $top: 1
                },
                authentication: "@parameters('$authentication')"
            }
        },
        Build_ServiceNow_payload: {
            runAfter: { Get_quality_evaluation: ['Succeeded', 'Failed'] },
            type: 'Compose',
            inputs: {
                conversation_id: "@triggerOutputs()?['body/activityid']",
                status: 'Completed',
                call_received: "@body('Get_conversation')?['msdyn_createdon']",
                agent_connected: "@body('Get_conversation')?['msdyn_activeagentassignedon']",
                call_ended: "@coalesce(body('Get_conversation')?['msdyn_closedon'], body('Get_conversation')?['msdyn_wrapupinitiatedon'], utcNow())",
                queue: "@body('Get_conversation')?['_msdyn_cdsqueueid_value@OData.Community.Display.V1.FormattedValue']",
                agent: "@body('Get_conversation')?['_msdyn_activeagentid_value@OData.Community.Display.V1.FormattedValue']",
                customer_sentiment: "@body('Get_conversation')?['msdyn_customersentimentlabel@OData.Community.Display.V1.FormattedValue']",
                handled_by_virtual_agent: "@equals(body('Get_conversation')?['msdyn_copilotengaged'], true)",
                talk_time_seconds: "@body('Get_conversation')?['msdyn_conversationtalktimeinseconds']",
                wait_time_seconds: "@body('Get_conversation')?['msdyn_conversationfirstwaittimeinseconds']",
                handle_time_seconds: "@body('Get_conversation')?['msdyn_conversationhandletimeinseconds']",
                called_number: "@body('Get_conversation')?['msdyn_channelconnectionid']",
                quality_score: `@${eval0}?['msdyn_evaluationscore']`,
                quality_evaluated_at: `@${eval0}?['createdon']`,
                quality_evaluation_json: `@${eval0}?['msdyn_responsejson']`,
                quality_plan: `@${json0}?['action_name']`,
                quality_summary: `@${json0}?['overall_summary']`,
                quality_action_plan: `@${json0}?['action_plan']`
            }
        },
        Update_ServiceNow_call: {
            runAfter: { Build_ServiceNow_payload: ['Succeeded'] },
            type: 'Http',
            inputs: {
                method: 'POST',
                uri: `https://${cfg.instance}/api/global/d365cc/call`,
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: "@outputs('Build_ServiceNow_payload')",
                authentication: { type: 'Basic', username: process.env.SN_INTEGRATION_USER || 'd365cc.integration', password: process.env.SN_INTEGRATION_PASS }
            }
        }
    },
    outputs: {}
};

const clientdata = {
    properties: {
        connectionReferences: {
            shared_commondataserviceforapps: {
                runtimeSource: 'embedded',
                connection: { connectionReferenceLogicalName: dataverseRef },
                api: { name: 'shared_commondataserviceforapps' }
            }
        },
        definition
    },
    schemaVersion: '1.0.0.0'
};

const H = { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json', 'OData-Version': '4.0' };
const base = `${org}/api/data/v9.2`;

const existing = await (await fetch(`${base}/workflows?$select=workflowid,statecode&$filter=name eq '${FLOW_NAME}'`, { headers: H })).json();
const body = {
    name: FLOW_NAME, category: 5, type: 1, primaryentity: 'none', clientdata: JSON.stringify(clientdata),
    description: 'Sends call metrics and the AI quality evaluation to ServiceNow when a voice conversation ends.'
};
let id;
if (existing.value?.length) {
    id = existing.value[0].workflowid;
    if (existing.value[0].statecode === 1) await fetch(`${base}/workflows(${id})`, { method: 'PATCH', headers: H, body: JSON.stringify({ statecode: 0, statuscode: 1 }) });
    const r = await fetch(`${base}/workflows(${id})`, { method: 'PATCH', headers: H, body: JSON.stringify({ clientdata: body.clientdata }) });
    if (!r.ok) throw new Error('update failed: ' + (await r.text()));
    log(`updated flow ${id}`);
} else {
    const r = await fetch(`${base}/workflows`, { method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error('create failed: ' + (await r.text()));
    id = (await r.json()).workflowid;
    log(`created flow ${id}`);
}
log('flow id: ' + id);
