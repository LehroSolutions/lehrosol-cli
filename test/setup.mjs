// Each test process gets its own state home before application modules load.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const testHome = mkdtempSync(join(process.env.LEHRO_TEST_ROOT || tmpdir(), 'lehrosol-test-'));
process.env.LEHRO_HOME = testHome;
if (!process.env.LEHRO_TEST_ROOT) process.on('exit', () => {
  try {
    rmSync(testHome, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch (err) {
    // Windows can keep SQLite files locked until this process has exited.
    console.warn(`Could not remove temporary test home ${testHome}: ${err.message}`);
  }
});
