<#
.SYNOPSIS
    View KeyProxy logs.
#>
& (Join-Path (Split-Path $PSScriptRoot -Parent) "..\manage.ps1") logs
