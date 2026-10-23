// `npm run reset [restaurant-code]`: starts a restaurant over with fresh demo data, after saving the current
// data as a backup. Backups and logs are never deleted. Stop the server before running this.
import fs from 'node:fs';
import { openTenant, tenantExists, withTenant } from './db/index.js';
import { snapshot } from './services/backup.js';

const slug = process.argv[2] || 'main';
if (!tenantExists(slug)) {
  console.error(`No restaurant with code "${slug}".`);
  process.exit(1);
}
const t = openTenant(slug);
const name = withTenant(t, () => snapshot('before-cli-reset'));
t.db.close();
for (const ext of ['', '-wal', '-shm']) fs.rmSync(t.file + ext, { force: true });
console.log(`Saved the current data of "${slug}" as backups/${name}.`);
console.log('Database removed — it will be recreated with demo data on the next start. Restore the backup from Settings if needed.');
