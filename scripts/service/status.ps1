<#
.SYNOPSIS
    Show KeyProxy service status.
#>
& (Join-Path (Split-Path $PSScriptRoot -Parent) "..\manage.ps1") status
