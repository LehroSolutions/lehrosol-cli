// Single source of truth for the dashboard's displayed license: package.json.
// Vite inlines this import at build time, so the footer cannot drift after a
// relicense (the GPL-3.0-or-later string used to be hardcoded in App.jsx and
// outlived the Apache-2.0 switch in 3.2.0-beta.1).
import pkg from '../../../package.json';

export const LICENSE = typeof pkg?.license === 'string' && pkg.license ? pkg.license : 'Apache-2.0';
