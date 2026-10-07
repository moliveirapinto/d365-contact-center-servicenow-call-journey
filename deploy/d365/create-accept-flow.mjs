// Builds the D365 -> ServiceNow flow that creates the Case (and the call) the moment an agent accepts a voice call.
// Usage: node deploy/d365/create-flow.mjs   (needs D365_TOKEN, SN_INTEGRATION_PASS and .env.local)
import fs from 'node:fs';
import { cfg, log } from '../lib.mjs';

const org = cfg.d365Url;
const token = (process.env.D365_TOKEN || '').trim();
if (!token) throw new Error('Set D365_TOKEN to a Dataverse access token for ' + org);
if (!process.env.SN_INTEGRATION_PASS) throw new Error('Set SN_INTEGRATION_PASS (the ServiceNow integration user password).');

const FLOW_NAME = 'D365 Contact Center - Create ServiceNow case when an agent accepts a call';
// Logical name of a Dataverse connection reference that exists in your environment (see README).
const dataverseRef = process.env.D365_DATAVERSE_CONNREF || 'new_d365cc_dataverse';



const CDS = { connectionName: 'shared_commondataserviceforapps', apiId: '/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps' };

const definition = {
    $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
    contentVersion: '1.0.0.0',
    parameters: {
        $connections: { defaultValue: {}, type: 'Object' },
        $authentication: { defaultValue: {}, type: 'SecureObject' }
    },
    triggers: {
        When_an_agent_is_assigned_to_a_voice_call: {
            type: 'OpenApiConnectionWebhook',
            inputs: {
                host: { ...CDS, operationId: 'SubscribeWebhookTrigger' },
                parameters: {
                    'subscriptionRequest/message': 3,
                    'subscriptionRequest/entityname': 'msdyn_ocliveworkitem',
                    'subscriptionRequest/scope': 4,
                    'subscriptionRequest/filteringattributes': 'msdyn_activeagentassignedon',
                    'subscriptionRequest/filterexpression': '(msdyn_channel eq 192440000)'
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
                    $select: 'subject,msdyn_createdon,msdyn_activeagentassignedon,msdyn_channelconnectionid,msdyn_copilotengaged,_msdyn_customer_value,_msdyn_cdsqueueid_value,_msdyn_activeagentid_value'
                },
                authentication: "@parameters('$authentication')"
            }
        },
        Get_customer: {
            runAfter: { Get_conversation: ['Succeeded'] },
            type: 'OpenApiConnection',
            inputs: {
                host: { ...CDS, operationId: 'ListRecords' },
                parameters: {
                    entityName: 'contacts',
                    $select: 'fullname,mobilephone,telephone1,emailaddress1',
                    $filter: "contactid eq '@{coalesce(body('Get_conversation')?['_msdyn_customer_value'], '00000000-0000-0000-0000-000000000000')}'",
                    $top: 1
                },
                authentication: "@parameters('$authentication')"
            }
        },
        Build_ServiceNow_payload: {
            runAfter: { Get_customer: ['Succeeded', 'Failed'] },
            type: 'Compose',
            inputs: {
                conversation_id: "@triggerOutputs()?['body/activityid']",
                create_case: true,
                status: 'In progress',
                subject: "@body('Get_conversation')?['subject']",
                call_received: "@body('Get_conversation')?['msdyn_createdon']",
                agent_connected: "@coalesce(body('Get_conversation')?['msdyn_activeagentassignedon'], utcNow())",
                queue: "@body('Get_conversation')?['_msdyn_cdsqueueid_value@OData.Community.Display.V1.FormattedValue']",
                agent: "@body('Get_conversation')?['_msdyn_activeagentid_value@OData.Community.Display.V1.FormattedValue']",
                handled_by_virtual_agent: "@equals(body('Get_conversation')?['msdyn_copilotengaged'], true)",
                called_number: "@body('Get_conversation')?['msdyn_channelconnectionid']",
                contact_name: "@first(body('Get_customer')?['value'])?['fullname']",
                contact_email: "@first(body('Get_customer')?['value'])?['emailaddress1']",
                caller_phone: "@coalesce(first(body('Get_customer')?['value'])?['mobilephone'], first(body('Get_customer')?['value'])?['telephone1'])"
            }
        },
        Create_ServiceNow_case_and_call: {
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
    description: 'Creates the ServiceNow Case and Contact Center Call when an agent accepts a voice call.'
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
