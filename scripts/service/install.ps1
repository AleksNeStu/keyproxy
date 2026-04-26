<#
.SYNOPSIS
    Install KeyProxy as a Windows Service (requires Admin).
#>
& (Join-Path (Split-Path $PSScriptRoot -Parent) "manage.ps1") install
