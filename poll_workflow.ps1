# Poll GitHub Actions run status until completion (max 45 min)
$runId = "30684845332"
$url = "https://api.github.com/repos/ayanshaikh2491-stack/datashare/actions/runs/$runId"
$start = Get-Date
for ($i = 1; $i -le 60; $i++) {
    try {
        $r = Invoke-RestMethod -Uri $url -Headers @{ "User-Agent" = "jcode" } -TimeoutSec 20
        $status = $r.status
        $conclusion = $r.conclusion
        $elapsed = [math]::Round(((Get-Date) - $start).TotalMinutes, 1)
        $msg = "poll ${i}: status=${status} conclusion=${conclusion} elapsed=${elapsed}m"
        Write-Output ("JCODE_PROGRESS {""percent"":0,""message"":""" + $msg + """}")
        if ($status -eq "completed") {
            Write-Output ("JCODE_CHECKPOINT {""message"":""Workflow completed: conclusion=" + $conclusion + """}")
            if ($conclusion -eq "success") { exit 0 } else { exit 1 }
        }
    } catch {
        Write-Output ("poll ${i}: fetch error " + $_.Exception.Message)
    }
    Start-Sleep -Seconds 45
}
Write-Output "JCODE_CHECKPOINT {""message"":""Poll timeout (45 min)""}"
exit 2
