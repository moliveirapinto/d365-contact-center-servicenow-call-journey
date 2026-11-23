<#
.SYNOPSIS
  Applies the Conversation form fix and checks the content security policy in a Dynamics 365 environment.

.DESCRIPTION
  1. Adds the web resource library new_d365cc_evaluationpanefix.js and its On load handler
     (D365CC.EvaluationPaneFix.onLoad, pass execution context ON) to the "Conversation Form" of the
     Conversation table (msdyn_ocliveworkitem), then publishes the table. Safe to run twice.
  2. Reads the environment's content security policy and says whether https://*.service-now.com (and your custom ServiceNow domain)`n     must be added to frame-ancestors (only needed when "Enforce content
     security policy" is ON for model-driven apps).

  Sign in first with:  az login   (use an account that is System Administrator or System Customizer).

.EXAMPLE
  ./Apply-ConversationFormFix.ps1 -OrgUrl https://contoso.crm.dynamics.com -WhatIf
  ./Apply-ConversationFormFix.ps1 -OrgUrl https://contoso.crm.dynamics.com
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)][string]$OrgUrl,
    [string]$Subscription
)

$ErrorActionPreference = 'Stop'
$OrgUrl = $OrgUrl.TrimEnd('/')
$lib = 'new_d365cc_evaluationpanefix.js'
$fn = 'D365CC.EvaluationPaneFix.onLoad'

$tokenArgs = @('account', 'get-access-token', '--resource', $OrgUrl, '--query', 'accessToken', '-o', 'tsv')
if ($Subscription) { $tokenArgs += @('--subscription', $Subscription) }
$token = (& az @tokenArgs) 2>$null
if (-not $token) { throw "Could not get a token. Run 'az login' first (and pass -Subscription if you have several)." }
$h = @{ Authorization = "Bearer $token"; Accept = 'application/json'; 'Content-Type' = 'application/json; charset=utf-8' }
$api = "$OrgUrl/api/data/v9.2/"

# 1. Web resource (created, or updated with the current script)
$src = Join-Path $PSScriptRoot "webresource-source\$lib"
if (-not (Test-Path $src)) { throw "Cannot find $src" }
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($src))
$wr = (Invoke-RestMethod -Headers $h ($api + "webresourceset?`$filter=name eq '$lib'&`$select=name,webresourceid")).value
if ($PSCmdlet.ShouldProcess("web resource $lib", "create or update")) {
    if ($wr) {
        Invoke-RestMethod -Method Patch -Headers $h ($api + "webresourceset($($wr[0].webresourceid))") -Body (@{ content = $b64 } | ConvertTo-Json) | Out-Null
        $wrId = $wr[0].webresourceid
    } else {
        $created = Invoke-RestMethod -Method Post -Headers ($h + @{ Prefer = 'return=representation' }) ($api + 'webresourceset') -Body (@{ name = $lib; displayname = 'D365 Contact Center evaluation pane fix'; webresourcetype = 3; content = $b64 } | ConvertTo-Json)
        $wrId = $created.webresourceid
    }
    $pubWr = @{ ParameterXml = "<importexportxml><webresources><webresource>{$wrId}</webresource></webresources></importexportxml>" } | ConvertTo-Json
    Invoke-RestMethod -Method Post -Headers $h ($api + 'PublishXml') -Body $pubWr | Out-Null
    Write-Host "Web resource $lib ready."
}
# 2. Conversation form
$forms = (Invoke-RestMethod -Headers $h ($api + "systemforms?`$filter=objecttypecode eq 'msdyn_ocliveworkitem' and type eq 2 and name eq 'Conversation Form'&`$select=formid,name,formxml")).value
if (-not $forms) { throw "The 'Conversation Form' (Main) of table msdyn_ocliveworkitem was not found." }
foreach ($form in $forms) {
    $xml = $form.formxml
    if ($xml -match [regex]::Escape("libraryName=`"$lib`"")) {
        Write-Host "Form $($form.formid): handler already present. Nothing to do."
        continue
    }
    $libTag = "<Library name=`"$lib`" libraryUniqueId=`"{$([guid]::NewGuid())}`" />"
    $handler = "<Handler functionName=`"$fn`" libraryName=`"$lib`" handlerUniqueId=`"{$([guid]::NewGuid())}`" enabled=`"true`" parameters=`"`" passExecutionContext=`"true`" />"
    if ($xml -match '<formLibraries>') {
        $xml = $xml -replace '<formLibraries>', "<formLibraries>$libTag"
    } elseif ($xml -match '<formLibraries\s*/>') {
        $xml = $xml -replace '<formLibraries\s*/>', "<formLibraries>$libTag</formLibraries>"
    } else {
        $xml = $xml -replace '</form>', "<formLibraries>$libTag</formLibraries></form>"
    }
    if ($xml -match '<event name="onload"[^>]*>\s*<Handlers>') {
        $xml = [regex]::Replace($xml, '(<event name="onload"[^>]*>\s*<Handlers>)', "`$1$handler", 1)
    } elseif ($xml -match '<events>') {
        $xml = $xml -replace '<events>', "<events><event name=`"onload`" application=`"false`" active=`"false`"><Handlers>$handler</Handlers></event>"
    } else {
        $xml = $xml -replace '</formLibraries>', "</formLibraries><events><event name=`"onload`" application=`"false`" active=`"false`"><Handlers>$handler</Handlers></event></events>"
    }
    [void][xml]$xml   # throws if the result is not well-formed
    if ($PSCmdlet.ShouldProcess("Conversation Form $($form.formid)", "add $lib and the On load handler $fn")) {
        Invoke-RestMethod -Method Patch -Headers $h ($api + "systemforms($($form.formid))") -Body (@{ formxml = $xml } | ConvertTo-Json) | Out-Null
        $pub = @{ ParameterXml = '<importexportxml><entities><entity>msdyn_ocliveworkitem</entity></entities></importexportxml>' } | ConvertTo-Json
        Invoke-RestMethod -Method Post -Headers $h ($api + 'PublishXml') -Body $pub | Out-Null
        Write-Host "Form $($form.formid): handler added and published."
    }
}

# 3. Content security policy (read only)
$org = (Invoke-RestMethod -Headers $h ($api + "organizations?`$select=iscontentsecuritypolicyenabled,contentsecuritypolicyconfiguration")).value[0]
if (-not $org.iscontentsecuritypolicyenabled) {
    Write-Host 'Content security policy: not enforced for model-driven apps. Nothing to add.'
} else {
    Write-Host 'Content security policy: ENFORCED. Current configuration:'
    Write-Host $org.contentsecuritypolicyconfiguration
    Write-Warning ('Make sure frame-ancestors allows https://*.service-now.com (and your custom ServiceNow host) ' +
        '(and your other CRM hosts if you share the environment). Power Platform admin center > Environments > your environment > Settings > ' +
        'Product > Privacy + Security > Content security policy > App (model-driven) > Configure directives. ' +
        'Only the recording pop-up needs this.')
}


