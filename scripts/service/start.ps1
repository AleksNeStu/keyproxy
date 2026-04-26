<#
.SYNOPSIS
    Start KeyProxy Windows Service (requires Admin).
#>
& (Join-Path (Split-Path $PSScriptRoot -Parent) "..\manage.ps1") start
