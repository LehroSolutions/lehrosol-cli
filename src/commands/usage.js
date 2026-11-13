import { readUsage } from '../core/usage.js';
import { ui } from '../core/ui.js';

export function runUsageCommand(flags = {}, logger = console) {
  const result = readUsage({ days: flags.days });
  if (flags.json) {
    if (logger.json) logger.json(result); else console.log(JSON.stringify(result, null, 2));
  } else {
    ui.sectionHeader(`Model usage — last ${result.periodDays} UTC days`);
    ui.table(['Model', 'Requests', 'Input tokens', 'Output tokens', 'Unmeasured'], result.models.map((m) => [m.model, String(m.requests), String(m.promptTokens), String(m.completionTokens), String(m.unmeasuredRequests)]));
    if (!result.models.length) ui.keyValue('Usage', 'No instrumented requests recorded yet.');
    if (result.truncated) ui.warning('Partial totals', 'Only the most recent 2 MiB per day was read.');
  }
  return result;
}
