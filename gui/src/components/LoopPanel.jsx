import React, { useState } from 'react';
import { callTool } from '../lib/rpcClient.js';
import { Card, Button, TextInput, Badge } from './Panel.jsx';

const ADAPTER_OPTIONS = ['local', 'claude-code', 'codex', 'opencode', 'gemini-cli', 'aider', 'goose', 'hermes-agent'];

export default function LoopPanel() {
  const [prompt, setPrompt] = useState('');
  const [adapter, setAdapter] = useState('local');
  const [dryRun, setDryRun] = useState(true);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function run() {
    if (!prompt.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await callTool('loop_run', { prompt: prompt, agentAdapter: adapter, dryRun: dryRun, owaspScope: ['llm', 'web'] });
      setResult(res);
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card title="Loop Engine">
      <div className="space-y-3">
        <TextInput placeholder="Prompt for the loop, e.g. harden the auth endpoint" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        <div className="flex flex-wrap items-center gap-3">
          <select value={adapter} onChange={(e) => setAdapter(e.target.value)} className="rounded-md bg-black/30 border border-white/10 px-2 py-1.5 text-sm text-slate-200">
            {ADAPTER_OPTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm text-slate-400">
            <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
            dry run
          </label>
          <Button variant="primary" onClick={run} disabled={loading || !prompt.trim()}>{loading ? 'Running...' : 'Run loop'}</Button>
        </div>
        {error && <p className="text-hud-red text-sm">{error}</p>}
        {result && (
          <div className="mt-2 space-y-2">
            <div className="text-sm text-slate-400">
              session <code className="text-slate-300">{result.sessionId}</code> - {result.totalIterations} iteration(s) - <span className="text-slate-200">{result.finalVerdict}</span>
            </div>
            {result.iterations.map((it) => (
              <div key={it.iteration} className="flex items-center gap-2 text-sm border-t border-white/5 pt-2">
                <Badge ok={it.score.passed}>{it.score.score}/100</Badge>
                <span className="text-slate-400">iteration {it.iteration}</span>
                <span className="text-slate-500">{it.score.verdict}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
