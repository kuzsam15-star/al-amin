# AL-AMIN owner backup export guide

## Current gate

The first owner-approved production-derived export and two isolated restores
completed successfully on 2026-08-12/13. RPO/RTO targets are owner-approved.
Future generations remain owner-operated and read-only and require fresh Owner
Gate 1 authorization plus a new temporary S3 key.

Each run reads real AL-AMIN database rows and Storage object bytes without
changing the database, Storage, Auth, configuration, or application. Plaintext
exists only in an ACL-protected local temporary directory until an authenticated
encrypted archive is verified, then the toolkit removes that directory.

## What Viktor prepares

1. A final backup folder outside the Git repository.
2. The current database host, port, database name, user, and password. Enter
   these only into the local terminal. Never paste them into chat.
3. A temporary Supabase Storage S3 access key created in Dashboard immediately
   before export. Enter its ID and secret only into the local terminal. Never
   paste either value into chat.
4. The endpoint copied from the S3 Configuration page must end in
   `/storage/v1/s3`; the region must be copied exactly from the same page. The
   wrapper rejects any other host/path/region contract before using the key.
5. A new strong archive passphrase known only to Viktor. The `age` prompt hides
   it; the toolkit asks for it again solely to authenticate the ciphertext.

No `service_role`, Supabase personal access token, `supabase login`, project
link, paid add-on, password reset, or production write is required.

## One-button workflow

1. Run `scripts\recovery\START_RECOVERY_PROOF.bat`.
2. Choose **1** only after Owner Gate 1 is approved.
3. Read the safety message and type the local confirmation shown by the tool.
4. Enter connection and temporary S3 values locally. Use the exact official S3
   endpoint (including `/storage/v1/s3`) and exact region displayed together in
   Dashboard. They are not written to command history, Git, or reports.
5. Select the existing external backup folder and create the archive passphrase.
6. Wait for `Encrypted export PASS`.
7. Immediately delete the exact temporary S3 key in Supabase Dashboard before
   encryption continues.
8. Return to the security workstream and write only: `временный S3 ключ удалён`.
   Do not show the key.
9. After Gate 2 is recorded, run the BAT again, choose **2**, confirm revocation,
   select the `.age` artifact, and enter the archive passphrase for each of the
   two independent disposable local restores.

If any prompt, endpoint, output, or requested permission differs from this
guide, close the window and report the safe error text. Do not improvise.

## Source behavior

- Database: PostgreSQL `pg_dump`, `pg_dumpall`, and aggregate-only `SELECT`
  catalog/count queries through an ACL-protected temporary libpq service and
  password file. No credential is placed in a process argument.
- Storage: rclone source-side `copy` from fixed `avatars` and `profile-media`
  buckets after a silent read-only SigV4/ListObjects probe. Its isolated,
  process-scoped configuration permits only the operator-approved credential
  lifetime and ignores persistent or unrelated AWS/rclone credentials; the
  script contains no source upload, sync, move, or delete command.
- Configuration: the redacted recovery manifest is copied without secret values.

## Owner Gate 1

After reviewing this guide, authorize the first production read by replying
exactly:

`подтверждаю создание зашифрованной резервной копии реальных данных AL-AMIN`

At the same time approve or reject these provisional objectives:

- RPO: Database 24 hours; Storage 24 hours; Config every approved change.
- RTO: Database 8 hours; Storage 12 hours; Config 4 hours.

Do not include any credential in the response.
