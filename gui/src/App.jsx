import React, { useState } from 'react';
import DoctorPanel from './components/DoctorPanel.jsx';
import LoopPanel from './components/LoopPanel.jsx';
import AdaptersPanel from './components/AdaptersPanel.jsx';
import OrchestratePanel from './components/OrchestratePanel.jsx';
import PolicyPanel from './components/PolicyPanel.jsx';
import SessionsPanel from './components/SessionsPanel.jsx';

const TABS = [
  { id: 'doctor', label: 'Doctor' },
  { id: 'loop', label: 'Loop Engine' },
  { id: 'adapters', label: 'Adapters' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'orchestrate', label: 'Orchestrator' },
  { id: 'policy', label: 'Policy / OWASP' }
];

export default function App() {
  const [tab, setTab] = useState('doctor');

  return (
    <div className="min-h-screen px-6 py-8 mx-auto max-w-6xl">
      <header className="mb-8">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold tracking-wide text-hud-cyan">LEHROSOL</h1>
          <span className="text-xs uppercase tracking-[0.3em] text-slate-400">control plane dashboard</span>
        </div>
        <p className="mt-2 text-sm text-slate-400">
          One MCP control plane, two front ends. Everything here is also a `lehrosol` terminal command against the same state under
          <code className="mx-1 px-1 py-0.5 rounded bg-black/40 text-hud-cyan">~/.lehro</code>.
        </p>
      </header>

      <nav className="flex flex-wrap gap-2 mb-6">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={
              'px-4 py-2 rounded-lg text-sm border transition-colors ' +
              (tab === t.id
                ? 'border-hud-cyan text-hud-cyan bg-hud-cyan/10 shadow-glass'
                : 'border-white/10 text-slate-400 hover:text-slate-200 hover:border-white/30')
            }
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="relative glass-panel hud-scan p-6">
        {tab === 'doctor' && <DoctorPanel />}
        {tab === 'loop' && <LoopPanel />}
        {tab === 'adapters' && <AdaptersPanel />}
        {tab === 'sessions' && <SessionsPanel />}
        {tab === 'orchestrate' && <OrchestratePanel />}
        {tab === 'policy' && <PolicyPanel />}
      </main>

      <footer className="mt-8 text-xs text-center text-slate-600">
        LehroSol CLI (alias lehr-sol) &middot; GPL-3.0-or-later &middot; free &amp; open agentic engineering
      </footer>
    </div>
  );
}
