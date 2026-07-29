import React, { useState } from 'react';
import { callTool } from '../lib/rpcClient.js';
import { Card, Badge, Button } from './Panel.jsx';

export default function DoctorPanel() {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function runCheck() {
    setLoading(true);
    setError(null);
    try {
      const res = await callTool('doctor_check', {});
      setResult(res);
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card title="Project health check" right={<Button variant="primary" onClick={runCheck} disabled={loading}>{loading ? 'Checking...' : 'Run doctor'}</Button>}>
      {error && <p className="text-hud-red text-sm">{error} - is the control plane running? (`lehrosol gui` or `lehrosol mcp start --http`)</p>}
      {!result && !error && <p className="text-slate-500 text-sm">Run a read-only health check of the current project (same as `lehrosol doctor`).</p>}
      {result && (
        <div className="space-y-2">
          <div className="text-sm text-slate-400">cwd: <code className="text-slate-300">{result.cwd}</code></div>
          {result.checks.map((c) => (
            <div key={c.name} className="flex items-start gap-2 text-sm">
              <Badge ok={c.ok}>{c.ok ? 'OK' : 'ATTN'}</Badge>
              <div>
                <span className="text-slate-300 font-medium">{c.name}</span>
                <span className="text-slate-500"> - {c.detail}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
