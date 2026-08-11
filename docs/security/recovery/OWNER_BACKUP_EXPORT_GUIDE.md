# AL-AMIN owner backup export guide

## Current gate

The recovery toolkit is locally verified, but production export is **not
authorized yet**. Do not start choice 1 in `START_RECOVERY_PROOF.bat` until the
security workstream records the exact owner approval requested below.

The next owner-approved run will, for the first time, read real AL-AMIN database
rows and Storage object bytes. It will not change the database, Storage, Auth,
configuration, or application. Plaintext exists only in an ACL-protected local
temporary directory until an authenticated encrypted archive is verified, then
the toolkit removes that directory.

## What Viktor prepares

1. A final backup folder outside the Git repository.
2. The current database host, port, database name, user, and password. Enter
   these only into the local terminal. Never paste them into chat.
3. A temporary Supabase Storage S3 access key created in Dashboard immediately
   before export. Enter its ID and secret only into the local terminal. Never
   paste either value into chat.
4. A new strong archive passphrase known only to Viktor. The `age` prompt hides
   it; the toolkit asks for it again solely to authenticate the ciphertext.

No `service_role`, Supabase personal access token, `supabase login`, project
link, paid add-on, password reset, or production write is required.

## One-button workflow

1. Run `scripts\recovery\START_RECOVERY_PROOF.bat`.
2. Choose **1** only after Owner Gate 1 is approved.
3. Read the safety message and type the local confirmation shown by the tool.
4. Enter connection and temporary S3 values locally. They are not written to
   command history, Git, or reports.
5. Select the existing external backup folder and create the archive passphrase.
6. Wait for `Encrypted export PASS`.
7. Immediately delete the exact temporary S3 key in Supabase Dashboard.
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
  buckets. Its process-scoped configuration permits only the operator-approved
  credential lifetime; the script contains no source upload, sync, move, or
  delete command.
- Configuration: the redacted recovery manifest is copied without secret values.

## Owner Gate 1

After reviewing this guide, authorize the first production read by replying
exactly:

`подтверждаю создание зашифрованной резервной копии реальных данных AL-AMIN`

At the same time approve or reject these provisional objectives:

- RPO: Database 24 hours; Storage 24 hours; Config every approved change.
- RTO: Database 8 hours; Storage 12 hours; Config 4 hours.

Do not include any credential in the response.
