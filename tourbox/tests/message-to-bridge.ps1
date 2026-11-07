param([Parameter(Mandatory=$true)][int]$BridgePid,[Parameter(Mandatory=$true)][int[]]$Ids)
# Test harness only. Exercise the listener's actual isolated Windows message queue.
# Never sends keystrokes to a foreground application or posts to another process.
$ErrorActionPreference='Stop'
$proc=Get-Process -Id $BridgePid
if ($proc.ProcessName -notin @('FadesterTourBoxBridge','dotnet')) {throw 'Expected the bridge child.'}
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class FixtureQueue {
  [DllImport("user32.dll", EntryPoint="PostThreadMessageW")] public static extern bool Post(uint thread,uint message,UIntPtr w,IntPtr l);
}
'@
foreach($idx in $Ids){
  $sent=0
  foreach($thread in $proc.Threads){ if([FixtureQueue]::Post([uint32]$thread.Id,0x0312,[UIntPtr]::new([uint32]$idx),[IntPtr]::Zero)) {$sent++} }
  if(!$sent){throw 'No message queue in isolated listener.'}
}
