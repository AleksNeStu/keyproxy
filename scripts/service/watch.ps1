<#
.SYNOPSIS
    Tail KeyProxy logs in real-time (Ctrl+C to stop).
#>
& (Join-Path (Split-Path $PSScriptRoot -Parent) "..\manage.ps1") watch
