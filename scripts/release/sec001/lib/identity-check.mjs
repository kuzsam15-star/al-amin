import { readFile } from 'node:fs/promises';
import { assertProjectIdentity, fingerprintIdentity } from './release-state.mjs';

const path = process.argv[2];
if (!path) throw new Error('IDENTITY_FILE_REQUIRED');
const identity = JSON.parse(await readFile(path, 'utf8'));
assertProjectIdentity(String(identity.projectFingerprint).toUpperCase(), identity);
process.stdout.write(JSON.stringify({ status: 'PASS', projectFingerprint: fingerprintIdentity(identity) }));
