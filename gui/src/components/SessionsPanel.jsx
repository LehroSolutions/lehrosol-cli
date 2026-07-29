import React, { useEffect, useState } from 'react';
import { callTool } from '../lib/rpcClient.js';
import { Card, Button, Badge } from './Panel.jsx';

export default function SessionsPanel() {
  const [sessions, setSessions] = useState([]);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState(null);

  async function load() {
    setError(null);
    try {
      const res = await callTool('sessions_list', { limit: 20 });
      setSessions(res.sessions || []);
    } catch (err) {
      setError(String(err.message || err));
    }
  }

  async function open(id) {
    try {
      const res = await callTool('sessions_show', { id: id });
      setSelected(res);
    } catch (err) {
      setError(String(err.message || err));
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <Card title="Loop Engine sessions" right={<Button onClick={load}>Refresh</Button>}>
      {error && <p className="text-hud-red text-sm mb-2">{error}</p>}
      {sessions.length === 0 && <p className="text-slate-500 text-sm">No sessions yet - run something from the Loop Engine tab.</p>}
      <div className="space-y-2 mb-4">
        {sessions.map((s) => (
          <button key={s.id} onClick={() => open(s.id)} className="w-full text-left rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm hover:border-hud-cyan/40">
            <div className="flex items-center justify-between">
              <span className="text-slate-200">{s.adapter}</span>
              <Badge ok={s.finalVerdict === 'stop-success'}>{s.finalVerdict || 'in-progress'}</Badge>
            </div>
            <div className="text-xs text-slate-500 truncate">{s.prompt}</div>
          </button>
        ))}
      </div>
      {selected && (
        <div className="border-t border-white/10 pt-3">
          <div className="text-sm text-slate-300 mb-2">Session {selected.id}</div>
          {(selected.checkpoints || []).map((cp) => (
            <div key={cp.iteration} className="text-xs text-slate-500">iteration {cp.iteration} @ {cp.createdAt}</div>
          ))}
        </div>
      )}
    </Card>
  );
}
