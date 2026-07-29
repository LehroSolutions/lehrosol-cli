import React from 'react';

export function Card({ title, children, right }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-4 mb-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">{title}</h3>
        {right}
      </div>
      {children}
    </div>
  );
}

export function Badge({ ok, children }) {
  return (
    <span
      className={
        'inline-block px-2 py-0.5 rounded text-xs font-medium ' +
        (ok ? 'bg-hud-green/15 text-hud-green' : 'bg-hud-red/15 text-hud-red')
      }
    >
      {children}
    </span>
  );
}

export function Button({ children, onClick, disabled, variant }) {
  const base = 'px-3 py-1.5 rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
  const styles = variant === 'primary'
    ? 'bg-hud-cyan/20 text-hud-cyan border border-hud-cyan/40 hover:bg-hud-cyan/30'
    : 'bg-white/5 text-slate-300 border border-white/10 hover:bg-white/10';
  return (
    <button className={base + ' ' + styles} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export function TextInput(props) {
  return (
    <input
      {...props}
      className={'w-full rounded-md bg-black/30 border border-white/10 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-hud-cyan/60 ' + (props.className || '')}
    />
  );
}
