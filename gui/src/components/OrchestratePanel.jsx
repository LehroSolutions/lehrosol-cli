import React, { useEffect, useState } from 'react';
import { callTool } from '../lib/rpcClient.js';
import { Card, Button, TextInput } from './Panel.jsx';

export default function OrchestratePanel() {
  const [workers, setWorkers] = useState([]);
  const [count, setCount] = useState('1');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    try {
      const res = await callTool('orchestrate_list', {});
      setWorkers(res.worktrees || []);
    } catch (err) {
      setError(String(err.message || err));
    }
  }

  useEffect(() => { refresh(); }, []);

  async function spawn() {
    setLoading(true);
    setError(null);
    try {
      await callTool('orchestrate_spawn', { count: Number(count) || 1 });
      await refresh();
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setLoading(false);
    }
  }

  async function remove(name) {
    try {
      await callTool('orchestrate_remove', { name: name });
      await refresh();
    } catch (err) {
      setError(String(err.message || err));
    }
  }

  return (
    <Card title="Git-worktree orchestrator" right={<Button onClick={refresh}>Refresh</Button>}>
      <div className="flex items-center gap-3 mb-4">
        <TextInput className="w-24" type="number" min="1" value={count} onChange={(e) => setCount(e.target.value)} />
        <Button variant="primary" onClick={spawn} disabled={loading}>{loading ? 'Spawning...' : 'Spawn workers'}</Button>
      </div>
      {error && <p className="text-hud-red text-sm mb-2">{error} (needs to run inside a git repository)</p>}
      {workers.length === 0 && <p className="text-slate-500 text-sm">No active worktree workers.</p>}
      <div className="space-y-2">
        {workers.map((w) => (
          <div key={w.name} className="flex items-center justify-between rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm">
            <div>
              <div className="text-slate-200">{w.name}</div>
              <div className="text-xs text-slate-500">{w.dir}</div>
            </div>
            <Button onClick={() => remove(w.name)}>Remove</Button>
          </div>
        ))}
      </div>
    </Card>
  );
}
