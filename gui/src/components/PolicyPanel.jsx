import React, { useState } from 'react';
import { callTool } from '../lib/rpcClient.js';
import { Card, Button, TextInput, Badge } from './Panel.jsx';

export default function PolicyPanel() {
  const [branch, setBranch] = useState('feature/example');
  const [hasTests, setHasTests] = useState(true);
  const [reviewCount, setReviewCount] = useState('1');
  const [owaspScope, setOwaspScope] = useState('llm,web');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  async function evaluate() {
    setError(null);
    try {
      const res = await callTool('policy_evaluate', {
        branch: branch,
        hasTests: hasTests,
        reviewCount: Number(reviewCount) || 0,
        owaspScope: owaspScope.split(',').map((s) => s.trim()).filter(Boolean)
      });
      setResult(res);
    } catch (err) {
      setError(String(err.message || err));
    }
  }

  return (
    <Card title="Policy / OWASP gate">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <TextInput placeholder="branch" value={branch} onChange={(e) => setBranch(e.target.value)} />
        <TextInput placeholder="owaspScope (comma-separated)" value={owaspScope} onChange={(e) => setOwaspScope(e.target.value)} />
        <TextInput placeholder="reviewCount" type="number" value={reviewCount} onChange={(e) => setReviewCount(e.target.value)} />
        <label className="flex items-center gap-2 text-sm text-slate-400">
          <input type="checkbox" checked={hasTests} onChange={(e) => setHasTests(e.target.checked)} />
          hasTests
        </label>
      </div>
      <Button variant="primary" onClick={evaluate}>Evaluate</Button>
      {error && <p className="text-hud-red text-sm mt-2">{error}</p>}
      {result && (
        <div className="mt-4 space-y-2">
          <div className="text-sm">
            <Badge ok={result.passed}>{result.score}/100 ({result.band})</Badge>
            <span className="ml-2 text-slate-400">{result.passed ? 'PASSED' : 'BLOCKED'}</span>
          </div>
          {result.violations.map((v, i) => (
            <div key={'v' + i} className="text-sm text-hud-red">- {v.name}: {v.fixSuggestion}</div>
          ))}
          {result.warnings.map((w, i) => (
            <div key={'w' + i} className="text-sm text-hud-amber">- {w.name}: {w.fixSuggestion}</div>
          ))}
        </div>
      )}
    </Card>
  );
}
