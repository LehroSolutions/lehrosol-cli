import React, { useEffect, useState } from 'react';
import { callTool } from '../lib/rpcClient.js';
import { Card, Badge, Button } from './Panel.jsx';

export default function AdaptersPanel() {
  const [adapters, setAdapters] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await callTool('adapters_list', {});
      setAdapters(res.adapters || []);
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <Card title="Agent CLI adapters" right={<Button onClick={load} disabled={loading}>{loading ? 'Refreshing...' : 'Refresh'}</Button>}>
      {error && <p className="text-hud-red text-sm">{error}</p>}
      <p className="text-slate-500 text-sm mb-3">Every agent CLI the Loop Engine can drive, and whether its binary is on PATH for this machine.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {adapters.map((a) => (
          <div key={a.id} className="flex items-center justify-between rounded-md border border-white/10 bg-black/20 px-3 py-2">
            <div>
              <div className="text-sm text-slate-200">{a.label}</div>
              <div className="text-xs text-slate-500">{a.id}{a.bin ? ' - bin: ' + a.bin : ''}</div>
            </div>
            <Badge ok={a.installed}>{a.installed ? 'installed' : 'missing'}</Badge>
          </div>
        ))}
      </div>
    </Card>
  );
}
