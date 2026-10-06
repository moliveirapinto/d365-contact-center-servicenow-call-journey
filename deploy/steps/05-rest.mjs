import { api, find, upsert, readSrc, log } from '../lib.mjs';

// Scripted REST API  POST /api/x_d365cc/... is not possible in the global scope without a custom scope,
// so the service lives in the global namespace: POST /api/global/d365cc/call
export default async function rest() {
    const svcId = await upsert('sys_ws_definition', 'name=D365 Contact Center', {
        name: 'D365 Contact Center',
        service_id: 'd365cc',
        namespace: 'global',
        active: 'true',
        short_description: 'Receives call data from Dynamics 365 Contact Center',
        enforce_acl: 'true'
    });

    await upsert('sys_ws_operation', `web_service_definition=${svcId}^name=Upsert call`, {
        web_service_definition: svcId,
        name: 'Upsert call',
        http_method: 'POST',
        relative_path: '/call',
        operation_script: readSrc('rest-upsert-call.js'),
        active: 'true',
        short_description: 'Create or update a Contact Center Call by conversation_id',
        requires_authentication: 'true',
        consumes: 'application/json',
        produces: 'application/json'
    });

    const def = await api('GET', `/api/now/table/sys_ws_definition/${svcId}?sysparm_fields=base_uri,namespace,service_id`);
    log(`  endpoint: POST https://<instance>${def.base_uri || '/api/global/d365cc'}/call`);
}
