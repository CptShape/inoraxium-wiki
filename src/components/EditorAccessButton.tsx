import React, { useEffect, useState } from 'react';
import { Lock, SquarePen } from 'lucide-react';
import { authProvider, AuthState } from '../lib/auth';
import { loadEditorAccess } from '../lib/editorPermissions';
import { GameSystemId } from '../types';

interface EditorAccessButtonProps {
  currentSystem: GameSystemId;
  isActive?: boolean;
  onOpenEditor: () => void;
}

export const EditorAccessButton: React.FC<EditorAccessButtonProps> = ({
  currentSystem,
  isActive = false,
  onOpenEditor,
}) => {
  const [authState, setAuthState] = useState<AuthState>({ uid: null, displayName: null });
  const [canEdit, setCanEdit] = useState(false);
  const [permissionLoading, setPermissionLoading] = useState(true);
  const [permissionSource, setPermissionSource] = useState<string | null>(null);

  useEffect(() => authProvider.onAuthChange(setAuthState), []);

  useEffect(() => {
    let cancelled = false;
    setPermissionLoading(true);

    loadEditorAccess(authState.uid)
      .then((access) => {
        if (cancelled) return;
        setCanEdit(access.canEdit);
        setPermissionSource(access.source);
      })
      .finally(() => {
        if (!cancelled) setPermissionLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [authState.uid]);

  if (permissionLoading) {
    return (
      <div className="rounded-lg border border-amber-800/30 bg-amber-950/10 p-3 text-xs text-amber-600">
        Checking editor permission...
      </div>
    );
  }

  if (!authState.uid) {
    return (
      <div className="rounded-lg border border-dashed border-stone-700/60 bg-stone-950/20 p-3 text-xs text-stone-400">
        Sign in with an editor-enabled account to open the visual page editor.
      </div>
    );
  }

  if (!canEdit) {
    return (
      <div className="rounded-lg border border-red-900/30 bg-red-950/15 p-3 text-xs text-red-300">
        <div className="flex items-center gap-2 font-bold">
          <Lock size={14} /> Editor Locked
        </div>
        <p className="mt-1 text-red-200/80">This account does not currently have `edit` permission.</p>
        {permissionSource && <p className="mt-1 text-[11px] text-red-300/60">Source: {permissionSource}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-xl border border-amber-800/40 bg-amber-950/10 p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-amber-600" style={{ fontFamily: "'Cinzel', serif" }}>
            Editor
          </p>
          <p className="text-[11px] text-amber-300/80">
            Open the visual wiki editor for {currentSystem}.
          </p>
        </div>
        <button
          onClick={onOpenEditor}
          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-bold transition-colors cursor-pointer ${
            isActive
              ? 'border-amber-500/60 bg-amber-900/45 text-amber-50'
              : 'border-amber-700/50 bg-amber-800/30 text-amber-100 hover:bg-amber-800/50'
          }`}
          style={{ fontFamily: "'Cinzel', serif" }}
        >
          <SquarePen size={15} /> {isActive ? 'Editor Open' : 'Open Editor'}
        </button>
      </div>
      {permissionSource && (
        <p className="text-[11px] text-amber-600/70">Access: {permissionSource}</p>
      )}
    </div>
  );
};

