import React, { useState, useEffect } from 'react';
import { LogOut, User, Settings, X, LogIn } from 'lucide-react';
import { authProvider, AuthState } from '../lib/auth';

interface LoginButtonProps {
  onStateChange?: (state: AuthState) => void;
}

export const LoginButton: React.FC<LoginButtonProps> = ({ onStateChange }) => {
  const [authState, setAuthState] = useState<AuthState>({ uid: null, displayName: null });
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    // Restore saved uid from localStorage (so we know who last logged in)
    const savedUid = localStorage.getItem('auth_uid');
    if (savedUid) {
      setAuthState((prev) => ({ ...prev, uid: savedUid }));
    }
    return authProvider.onAuthChange((state) => {
      setAuthState(state);
      if (state.uid) {
        localStorage.setItem('auth_uid', state.uid);
      } else {
        localStorage.removeItem('auth_uid');
      }
      onStateChange?.(state);
    });
  }, []);

  const handleLogin = async () => {
    setError('');
    try {
      await authProvider.signIn(email, password);
      setEmail('');
      setPassword('');
      setShowLoginModal(false);
    } catch (err: any) {
      setError(err.message || 'Login failed');
    }
  };

  const handleLogout = async () => {
    await authProvider.signOut();
    setShowMenu(false);
    setShowSettings(false);
  };

  const handleUpdateDisplayName = async () => {
    if (!newDisplayName.trim()) return;
    try {
      setError('');
      await authProvider.updateDisplayName(newDisplayName.trim());
      setSuccessMsg('Display name updated.');
      setTimeout(() => setSuccessMsg(''), 2000);
    } catch (err: any) {
      setError(err.message || 'Update failed');
    }
  };

  const handleUpdatePassword = async () => {
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    try {
      setError('');
      await authProvider.updatePassword(newPassword);
      setSuccessMsg('Password updated.');
      setTimeout(() => setSuccessMsg(''), 2000);
      setNewPassword('');
    } catch (err: any) {
      setError(err.message || 'Password update failed');
    }
  };

  const isLoggedIn = !!authState.uid;

  return (
    <>
      {/* Avatar / Login button — bottom of sidebar */}
      <div className="relative">
        {isLoggedIn ? (
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-lg bg-amber-900/20 border border-amber-800/30 hover:bg-amber-900/30 transition-colors text-left cursor-pointer"
          >
            <div className="w-8 h-8 rounded-full bg-amber-800/40 flex items-center justify-center text-amber-300 font-bold text-sm" style={{ fontFamily: "'Cinzel', serif" }}>
              {(authState.displayName || '?')[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-amber-200 truncate" style={{ fontFamily: "'Cinzel', serif" }}>{authState.displayName || 'User'}</p>
              <p className="text-[10px] text-amber-600/70 truncate">{authState.uid?.slice(0, 12)}</p>
            </div>
          </button>
        ) : (
          <button
            onClick={() => setShowLoginModal(true)}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-lg border border-dashed border-stone-600/50 hover:border-amber-600/50 hover:bg-amber-950/20 transition-colors cursor-pointer"
          >
            <LogIn size={18} className="text-stone-500" />
            <span className="text-sm text-stone-500 italic" style={{ fontFamily: "'IM Fell English', serif" }}>Sign In</span>
          </button>
        )}

        {/* Dropdown menu */}
        {showMenu && isLoggedIn && (
          <div className="absolute bottom-full left-0 right-0 mb-2 p-2 rounded-lg border border-amber-800/40 bg-stone-900 shadow-2xl">
            <button
              onClick={() => { setShowSettings(true); setShowMenu(false); setNewDisplayName(authState.displayName || ''); }}
              className="flex items-center gap-2 w-full px-3 py-2 rounded text-sm text-amber-200 hover:bg-amber-900/30 transition-colors cursor-pointer"
            >
              <Settings size={14} /> Profile Settings
            </button>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 w-full px-3 py-2 rounded text-sm text-red-400 hover:bg-red-950/30 transition-colors cursor-pointer"
            >
              <LogOut size={14} /> Sign Out
            </button>
          </div>
        )}
      </div>

      {/* Login Modal */}
      {showLoginModal && !isLoggedIn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setShowLoginModal(false)}>
          <div className="bg-stone-900 border border-amber-800/40 rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-amber-300" style={{ fontFamily: "'Cinzel', serif" }}>Sign In</h2>
              <button onClick={() => setShowLoginModal(false)} className="text-stone-500 hover:text-stone-300 cursor-pointer"><X size={18} /></button>
            </div>
            {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
            <div className="space-y-3">
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" className="w-full rounded-lg bg-stone-800 border border-stone-700 px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/50" />
              <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" type="password" className="w-full rounded-lg bg-stone-800 border border-stone-700 px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/50" />
              <button onClick={handleLogin} className="w-full rounded-lg bg-amber-800/50 border border-amber-700/50 px-4 py-2 text-sm font-bold text-amber-200 hover:bg-amber-800/70 transition-colors cursor-pointer" style={{ fontFamily: "'Cinzel', serif" }}>
                <LogIn size={14} className="inline mr-1" /> Sign In
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && isLoggedIn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setShowSettings(false)}>
          <div className="bg-stone-900 border border-amber-800/40 rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-amber-300" style={{ fontFamily: "'Cinzel', serif" }}>Profile Settings</h2>
              <button onClick={() => setShowSettings(false)} className="text-stone-500 hover:text-stone-300 cursor-pointer"><X size={18} /></button>
            </div>
            {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
            {successMsg && <p className="text-emerald-400 text-sm mb-3">{successMsg}</p>}
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-stone-400 mb-1">Display Name</label>
                <input value={newDisplayName} onChange={(e) => setNewDisplayName(e.target.value)} placeholder="Display Name" className="w-full rounded-lg bg-stone-800 border border-stone-700 px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/50" />
                <button onClick={handleUpdateDisplayName} className="mt-2 w-full rounded-lg bg-emerald-900/40 border border-emerald-700/50 px-3 py-1.5 text-sm text-emerald-200 hover:bg-emerald-800/50 cursor-pointer transition-colors" style={{ fontFamily: "'Cinzel', serif" }}><User size={13} className="inline mr-1" /> Update Name</button>
              </div>
              <div className="border-t border-stone-700/50 pt-4">
                <label className="block text-xs text-stone-400 mb-1">New Password</label>
                <input value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="New password (min 6)" type="password" className="w-full rounded-lg bg-stone-800 border border-stone-700 px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/50" />
                <button onClick={handleUpdatePassword} className="mt-2 w-full rounded-lg bg-amber-800/40 border border-amber-700/50 px-3 py-1.5 text-sm text-amber-200 hover:bg-amber-800/60 cursor-pointer transition-colors" style={{ fontFamily: "'Cinzel', serif" }}>Update Password</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
