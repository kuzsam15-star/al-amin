# AL-AMIN local pre-launch security gate

Launch `START_PRELAUNCH_SECURITY_GATE.bat`. The launcher performs a read-only,
local verification of Git provenance, frozen artifact hashes, recovery evidence,
dependency advisories, source/bundle secret patterns, build/tests and two
disposable role-matrix replays.

It never logs in to Supabase, links a project, applies remote SQL or uses a
production credential. Remote-target environment variables are removed by the
PowerShell launcher and rejected by the Node runner.

The only successful verdict is `READY_FOR_FINAL_BUNDLE_FREEZE`. A supplied
`ALAMIN_RECOVERY_ARTIFACT` must be an existing path outside the repository and
no older than the approved 24-hour RPO. The final deployment window must supply
a fresh encrypted artifact; absence is allowed only for the earlier local
freeze gate.
