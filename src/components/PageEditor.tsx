import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Copy,
  Download,
  FileImage,
  FileText,
  Layers3,
  Link2,
  Lock,
  Plus,
  SquarePen,
  Table2,
  Trash2,
  X,
} from 'lucide-react';
import MarkdownRenderer from './MarkdownRenderer';
import { authProvider, AuthState } from '../lib/auth';
import { loadEditorAccess } from '../lib/editorPermissions';
import { GameSystemId } from '../types';
import { createZip, stringToBytes } from '../utils/zip';

interface PageEditorLauncherProps {
  currentSystem: GameSystemId;
}

interface EditorAsset {
  id: string;
  file: File;
  exportPath: string;
  objectUrl: string;
}

interface InfoboxEntryDraft {
  id: string;
  label: string;
  value: string;
}

interface InfoboxSectionDraft {
  id: string;
  title: string;
  color: string;
  titleColor: string;
  entryBackgroundColor: string;
  labelColor: string;
  valueColor: string;
  defaultOpen: boolean;
  entries: InfoboxEntryDraft[];
}

interface InfoboxDraft {
  enabled: boolean;
  imagePath: string;
  imageAlt: string;
  titleBackgroundColor: string;
  titleTextColor: string;
  sections: InfoboxSectionDraft[];
}

interface PageMetadataDraft {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  system: GameSystemId;
  parentId: string;
  sidebarVisible: boolean;
  order: string;
  width: string;
}

interface EditorPageDraft {
  pageId: string;
  metadata: PageMetadataDraft;
  body: string;
  infobox: InfoboxDraft;
  assets: EditorAsset[];
}

const createId = () => Math.random().toString(36).slice(2, 10);

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const createDefaultInfoboxSection = (system: GameSystemId): InfoboxSectionDraft => ({
  id: createId(),
  title: 'Overview',
  color: system === 'horaghfus' ? '#b81932' : '#0052c2',
  titleColor: '#ffffff',
  entryBackgroundColor: '#ffffff',
  labelColor: '#000000',
  valueColor: '#000000',
  defaultOpen: true,
  entries: [
    {
      id: createId(),
      label: 'Example label',
      value: 'Example value',
    },
  ],
});

const createDefaultInfoboxDraft = (system: GameSystemId): InfoboxDraft => ({
  enabled: false,
  imagePath: '',
  imageAlt: '',
  titleBackgroundColor: system === 'horaghfus' ? '#b81932' : '#0052c2',
  titleTextColor: '#ffffff',
  sections: [createDefaultInfoboxSection(system)],
});

const createDefaultPageDraft = (system: GameSystemId, index = 1): EditorPageDraft => ({
  pageId: createId(),
  metadata: {
    id: '',
    title: `Untitled Page ${index}`,
    subtitle: '',
    icon: '',
    system,
    parentId: '',
    sidebarVisible: true,
    order: '',
    width: '0.78',
  },
  body: '',
  infobox: createDefaultInfoboxDraft(system),
  assets: [],
});

const buildInfoboxMarkup = (metadata: PageMetadataDraft, infobox: InfoboxDraft) => {
  if (!infobox.enabled) return '';

  const lines: string[] = [
    `<infobox${infobox.imagePath ? ` image="${infobox.imagePath}"` : ''}${infobox.imageAlt ? ` image-alt="${infobox.imageAlt}"` : ''}${infobox.titleBackgroundColor ? ` title-background-color="${infobox.titleBackgroundColor}"` : ''}${infobox.titleTextColor ? ` title-text-color="${infobox.titleTextColor}"` : ''}>`,
    `  <infobox-title>${metadata.title || 'Untitled Page'}</infobox-title>`,
    '',
  ];

  infobox.sections.forEach((section) => {
    lines.push(
      `  <infobox-section color="${section.color}" title-color="${section.titleColor}" entry-background-color="${section.entryBackgroundColor}" label-color="${section.labelColor}" value-color="${section.valueColor}" default-open="${section.defaultOpen ? 'true' : 'false'}">`
    );
    lines.push(`    <infobox-section-title>${section.title || 'Section'}</infobox-section-title>`);
    lines.push('');

    section.entries.forEach((entry) => {
      lines.push('    <infobox-entry>');
      lines.push(`      <infobox-entry-label>${entry.label || 'Label'}</infobox-entry-label>`);
      lines.push(`      <infobox-entry-value>${entry.value || 'Value'}</infobox-entry-value>`);
      lines.push('    </infobox-entry>');
      lines.push('');
    });

    lines.push('  </infobox-section>');
    lines.push('');
  });

  lines.push('</infobox>');
  return lines.join('\n').trim();
};

const buildCompiledMarkdown = (page: EditorPageDraft) => {
  const infoboxMarkup = buildInfoboxMarkup(page.metadata, page.infobox);
  return [infoboxMarkup, page.body.trim()].filter(Boolean).join('\n\n').trim();
};

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

const insertAtCursor = (
  textarea: HTMLTextAreaElement | null,
  value: string,
  snippet: string,
  onChange: (next: string) => void
) => {
  if (!textarea) {
    onChange(`${value}${value.endsWith('\n') ? '' : '\n'}${snippet}`);
    return;
  }

  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const next = `${value.slice(0, start)}${snippet}${value.slice(end)}`;
  onChange(next);

  requestAnimationFrame(() => {
    textarea.focus();
    const position = start + snippet.length;
    textarea.setSelectionRange(position, position);
  });
};

const wrapSelection = (
  textarea: HTMLTextAreaElement | null,
  value: string,
  before: string,
  after: string,
  onChange: (next: string) => void,
  fallback = 'text'
) => {
  if (!textarea) {
    onChange(`${value}${before}${fallback}${after}`);
    return;
  }

  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = value.slice(start, end) || fallback;
  const next = `${value.slice(0, start)}${before}${selected}${after}${value.slice(end)}`;
  onChange(next);

  requestAnimationFrame(() => {
    textarea.focus();
    const selectionStart = start + before.length;
    const selectionEnd = selectionStart + selected.length;
    textarea.setSelectionRange(selectionStart, selectionEnd);
  });
};

const buildPublishInfo = (pages: EditorPageDraft[]) => {
  const summary = pages.map((page) => {
    const id = page.metadata.id || '(missing id)';
    return `- ${id} [${page.metadata.system}] sidebar=${page.metadata.sidebarVisible ? 'yes' : 'no'} parent=${page.metadata.parentId || '(none)'}`;
  }).join('\n');

  return `Exported workspace contains ${pages.length} page(s).

Pages:
${summary}

Included files:
- manifest.json
- pages/<page-id>/page.md
- pages/<page-id>/body.md
- pages/<page-id>/assets/*

See docs/page-editor-export-workflow.md for publishing instructions.
`;
};

const duplicatePage = (page: EditorPageDraft): EditorPageDraft => {
  const clonedAssets = page.assets.map((asset) => ({
    ...asset,
    id: createId(),
    objectUrl: URL.createObjectURL(asset.file),
  }));

  return {
    pageId: createId(),
    metadata: {
      ...page.metadata,
      id: page.metadata.id ? `${page.metadata.id}-copy` : '',
      title: `${page.metadata.title} Copy`,
    },
    body: page.body,
    infobox: {
      ...page.infobox,
      sections: page.infobox.sections.map((section) => ({
        ...section,
        id: createId(),
        entries: section.entries.map((entry) => ({ ...entry, id: createId() })),
      })),
    },
    assets: clonedAssets,
  };
};

export const PageEditorLauncher: React.FC<PageEditorLauncherProps> = ({ currentSystem }) => {
  const [authState, setAuthState] = useState<AuthState>({ uid: null, displayName: null });
  const [canEdit, setCanEdit] = useState(false);
  const [permissionLoading, setPermissionLoading] = useState(true);
  const [permissionSource, setPermissionSource] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [portalReady, setPortalReady] = useState(false);

  const [pages, setPages] = useState<EditorPageDraft[]>(() => [createDefaultPageDraft(currentSystem)]);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [linkText, setLinkText] = useState('Read more');
  const [linkTarget, setLinkTarget] = useState('');
  const [linkTargetPart, setLinkTargetPart] = useState('');
  const [partId, setPartId] = useState('new-part');
  const [partLabel, setPartLabel] = useState('New Section');
  const [exportError, setExportError] = useState('');
  const [canvasMode, setCanvasMode] = useState<'write' | 'split' | 'preview'>('split');
  const [editorTextSize, setEditorTextSize] = useState<'sm' | 'base' | 'lg'>('base');

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => authProvider.onAuthChange(setAuthState), []);
  useEffect(() => setPortalReady(true), []);

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

  useEffect(() => {
    setPages((prev) =>
      prev.map((page, index) =>
        index === 0 && !page.metadata.id && page.metadata.system !== currentSystem
          ? {
              ...page,
              metadata: { ...page.metadata, system: currentSystem },
              infobox: {
                ...page.infobox,
                titleBackgroundColor: currentSystem === 'horaghfus' ? '#b81932' : '#0052c2',
              },
            }
          : page
      )
    );
  }, [currentSystem]);

  useEffect(() => {
    if (!activePageId && pages[0]) {
      setActivePageId(pages[0].pageId);
    }
  }, [activePageId, pages]);

  useEffect(() => () => {
    pages.forEach((page) => {
      page.assets.forEach((asset) => URL.revokeObjectURL(asset.objectUrl));
    });
  }, [pages]);

  const activePage = useMemo(
    () => pages.find((page) => page.pageId === activePageId) ?? pages[0] ?? null,
    [activePageId, pages]
  );

  const pageIdsInWorkspace = useMemo(
    () =>
      pages
        .map((page) => page.metadata.id.trim())
        .filter(Boolean)
        .sort(),
    [pages]
  );

  const assetMap = useMemo(
    () =>
      Object.fromEntries(
        (activePage?.assets ?? []).map((asset) => [asset.exportPath, asset.objectUrl])
      ),
    [activePage]
  );

  const compiledMarkdown = useMemo(
    () => (activePage ? buildCompiledMarkdown(activePage) : ''),
    [activePage]
  );

  const editorTextSizeClass =
    editorTextSize === 'sm' ? 'text-sm' : editorTextSize === 'lg' ? 'text-lg' : 'text-base';

  const updateActivePage = (updater: (page: EditorPageDraft) => EditorPageDraft) => {
    if (!activePage) return;
    setPages((prev) => prev.map((page) => (page.pageId === activePage.pageId ? updater(page) : page)));
  };

  const addNewPage = () => {
    const next = createDefaultPageDraft(currentSystem, pages.length + 1);
    setPages((prev) => [...prev, next]);
    setActivePageId(next.pageId);
  };

  const removePage = (pageId: string) => {
    setPages((prev) => {
      const target = prev.find((page) => page.pageId === pageId);
      target?.assets.forEach((asset) => URL.revokeObjectURL(asset.objectUrl));
      const next = prev.filter((page) => page.pageId !== pageId);
      if (next.length === 0) {
        const fallback = createDefaultPageDraft(currentSystem);
        setActivePageId(fallback.pageId);
        return [fallback];
      }
      if (activePageId === pageId) {
        setActivePageId(next[0].pageId);
      }
      return next;
    });
  };

  const duplicateActivePage = () => {
    if (!activePage) return;
    const copy = duplicatePage(activePage);
    setPages((prev) => [...prev, copy]);
    setActivePageId(copy.pageId);
  };

  const handleAssetUpload = (files: FileList | null) => {
    if (!files || !activePage) return;
    const nextAssets = Array.from(files).map((file) => ({
      id: createId(),
      file,
      exportPath: `assets/${slugify(file.name.replace(/\.[^.]+$/, '')) || 'asset'}-${createId()}${file.name.match(/\.[^.]+$/)?.[0] || ''}`,
      objectUrl: URL.createObjectURL(file),
    }));
    updateActivePage((page) => ({ ...page, assets: [...page.assets, ...nextAssets] }));
  };

  const removeAsset = (assetId: string) => {
    updateActivePage((page) => {
      const target = page.assets.find((asset) => asset.id === assetId);
      if (target) URL.revokeObjectURL(target.objectUrl);
      return { ...page, assets: page.assets.filter((asset) => asset.id !== assetId) };
    });
  };

  const upsertInfoboxSection = (sectionId: string, updater: (section: InfoboxSectionDraft) => InfoboxSectionDraft) => {
    updateActivePage((page) => ({
      ...page,
      infobox: {
        ...page.infobox,
        sections: page.infobox.sections.map((section) => (section.id === sectionId ? updater(section) : section)),
      },
    }));
  };

  const exportWorkspace = async () => {
    try {
      setExportError('');

      const normalizedPages = pages.map((page, index) => {
        const id = page.metadata.id.trim() || slugify(page.metadata.title) || `page-${index + 1}`;
        return {
          ...page,
          metadata: { ...page.metadata, id },
        };
      });

      const manifest = {
        version: 2,
        exportedAt: new Date().toISOString(),
        pageCount: normalizedPages.length,
        pages: normalizedPages.map((page) => ({
          metadata: {
            ...page.metadata,
            hiddenButLinkable: !page.metadata.sidebarVisible,
          },
          infobox: page.infobox,
          assets: page.assets.map((asset) => ({
            path: asset.exportPath,
            name: asset.file.name,
            type: asset.file.type,
            size: asset.file.size,
          })),
        })),
      };

      const workspaceSlug = slugify(normalizedPages[0]?.metadata.title || 'page-workspace') || 'page-workspace';
      const root = `${workspaceSlug}-export`;
      const zipEntries = [
        { name: `${root}/manifest.json`, data: stringToBytes(JSON.stringify(manifest, null, 2)) },
        { name: `${root}/publish-info.txt`, data: stringToBytes(buildPublishInfo(normalizedPages)) },
      ];

      for (const page of normalizedPages) {
        const compiled = buildCompiledMarkdown(page);
        zipEntries.push({ name: `${root}/pages/${page.metadata.id}/page.md`, data: stringToBytes(compiled) });
        zipEntries.push({ name: `${root}/pages/${page.metadata.id}/body.md`, data: stringToBytes(page.body) });

        for (const asset of page.assets) {
          zipEntries.push({
            name: `${root}/pages/${page.metadata.id}/${asset.exportPath}`,
            data: new Uint8Array(await asset.file.arrayBuffer()),
          });
        }
      }

      downloadBlob(createZip(zipEntries), `${root}.zip`);
    } catch (error) {
      console.error(error);
      setExportError('Workspace export failed. Please check your page IDs and assets.');
    }
  };

  if (permissionLoading) {
    return (
      <div className="rounded-lg border border-amber-800/30 bg-amber-950/10 p-3 text-xs text-amber-600">
        Checking editor permission…
      </div>
    );
  }

  if (!authState.uid) {
    return (
      <div className="rounded-lg border border-dashed border-stone-700/60 bg-stone-950/20 p-3 text-xs text-stone-400">
        Sign in with an editor-enabled account to create exportable pages.
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
    <>
      <div className="space-y-2 rounded-xl border border-amber-800/40 bg-amber-950/10 p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-amber-600" style={{ fontFamily: "'Cinzel', serif" }}>
              Editor
            </p>
            <p className="text-[11px] text-amber-300/80">
              Build a multi-page export workspace with markdown, infoboxes, and images.
            </p>
          </div>
          <button
            onClick={() => setIsOpen(true)}
            className="flex items-center gap-2 rounded-lg border border-amber-700/50 bg-amber-800/30 px-3 py-2 text-sm font-bold text-amber-100 hover:bg-amber-800/50 transition-colors cursor-pointer"
            style={{ fontFamily: "'Cinzel', serif" }}
          >
            <SquarePen size={15} /> Open Editor
          </button>
        </div>
      </div>

      {isOpen && portalReady && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-3" onClick={() => setIsOpen(false)}>
          <div
            className="flex h-[95vh] w-[96vw] max-w-[1800px] flex-col overflow-hidden rounded-3xl border border-amber-800/40 bg-stone-950 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-4 border-b border-amber-800/30 px-6 py-4">
              <div>
                <h2 className="text-2xl font-bold text-amber-300" style={{ fontFamily: "'Cinzel', serif" }}>
                  Page Workspace
                </h2>
                <p className="text-sm text-amber-600">
                  Create multiple linked pages, then export one ZIP package.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={addNewPage}
                  className="flex items-center gap-2 rounded-lg border border-amber-700/50 bg-amber-900/25 px-4 py-2 text-sm font-bold text-amber-100 hover:bg-amber-900/45 cursor-pointer"
                  style={{ fontFamily: "'Cinzel', serif" }}
                >
                  <Plus size={15} /> New Page
                </button>
                <button
                  onClick={exportWorkspace}
                  className="flex items-center gap-2 rounded-lg border border-emerald-700/50 bg-emerald-900/30 px-4 py-2 text-sm font-bold text-emerald-200 hover:bg-emerald-900/50 cursor-pointer"
                  style={{ fontFamily: "'Cinzel', serif" }}
                >
                  <Download size={15} /> Export Workspace ZIP
                </button>
                <button onClick={() => setIsOpen(false)} className="rounded-lg p-2 text-stone-400 hover:bg-stone-800 hover:text-stone-200 cursor-pointer">
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[18rem_minmax(0,1fr)]">
              <aside className="min-h-0 overflow-y-auto border-r border-amber-800/20 bg-stone-950/70 p-4">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-amber-600" style={{ fontFamily: "'Cinzel', serif" }}>
                      Created Pages
                    </p>
                    <p className="text-[11px] text-amber-300/70">{pages.length} page(s) in this export</p>
                  </div>
                  <button
                    onClick={addNewPage}
                    className="rounded-lg border border-amber-700/40 bg-amber-900/20 p-2 text-amber-200 hover:bg-amber-900/40 cursor-pointer"
                  >
                    <Plus size={14} />
                  </button>
                </div>

                <div className="space-y-2">
                  {pages.map((page, index) => {
                    const active = page.pageId === activePage?.pageId;
                    return (
                      <button
                        key={page.pageId}
                        onClick={() => setActivePageId(page.pageId)}
                        className={`w-full rounded-xl border p-3 text-left transition-colors cursor-pointer ${
                          active
                            ? 'border-amber-500/50 bg-amber-900/25'
                            : 'border-stone-800/70 bg-black/20 hover:border-stone-700 hover:bg-amber-950/10'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${active ? 'border-amber-500/40 bg-amber-900/30 text-amber-100' : 'border-stone-700 bg-stone-900 text-stone-400'}`}>
                            {page.metadata.icon || <Layers3 size={16} />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-bold text-amber-200" style={{ fontFamily: "'Cinzel', serif" }}>
                              {page.metadata.title || `Untitled ${index + 1}`}
                            </div>
                            <div className="truncate text-[11px] text-amber-600">
                              {page.metadata.id || 'No id yet'}
                            </div>
                            <div className="mt-1 flex flex-wrap gap-1">
                              <span className="rounded border border-stone-700/70 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-stone-400">
                                {page.metadata.system}
                              </span>
                              {!page.metadata.sidebarVisible && (
                                <span className="rounded border border-amber-700/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-300">
                                  hidden
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {activePage && (
                  <div className="mt-4 space-y-2 border-t border-amber-800/20 pt-4">
                    <button
                      onClick={duplicateActivePage}
                      className="flex w-full items-center gap-2 rounded-lg border border-amber-700/30 bg-amber-900/10 px-3 py-2 text-sm text-amber-200 hover:bg-amber-900/25 cursor-pointer"
                    >
                      <Copy size={14} /> Duplicate current page
                    </button>
                    <button
                      onClick={() => removePage(activePage.pageId)}
                      className="flex w-full items-center gap-2 rounded-lg border border-red-800/30 bg-red-950/15 px-3 py-2 text-sm text-red-300 hover:bg-red-950/25 cursor-pointer"
                    >
                      <Trash2 size={14} /> Delete current page
                    </button>
                    <div className="rounded-lg border border-stone-800 bg-black/20 p-3 text-xs text-stone-400">
                      Internal link targets in this workspace:
                      <div className="mt-2 flex flex-wrap gap-1">
                        {pageIdsInWorkspace.length === 0 ? (
                          <span className="text-stone-500">No page ids yet</span>
                        ) : (
                          pageIdsInWorkspace.map((id) => (
                            <span key={id} className="rounded border border-stone-700 px-1.5 py-0.5 text-[10px] text-amber-300">
                              {id}
                            </span>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </aside>

              <section className="min-h-0 overflow-y-auto p-4">
                {activePage && (
                  <div className="space-y-4">
                    <div className="rounded-3xl border border-amber-800/30 bg-stone-900/45 overflow-hidden">
                      <div className="border-b border-amber-800/20 px-5 py-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <h3 className="text-lg font-bold text-amber-300" style={{ fontFamily: "'Cinzel', serif" }}>
                              Writing Canvas
                            </h3>
                            <p className="text-xs text-amber-600">
                              Write and preview the page in one workspace, with the infobox generated automatically.
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            {(['write', 'split', 'preview'] as const).map((mode) => (
                              <button
                                key={mode}
                                onClick={() => setCanvasMode(mode)}
                                className={`rounded-lg border px-3 py-1.5 text-xs font-bold uppercase tracking-wide cursor-pointer ${
                                  canvasMode === mode
                                    ? 'border-amber-500/50 bg-amber-900/30 text-amber-100'
                                    : 'border-stone-700 bg-stone-900 text-stone-400 hover:border-amber-800/40 hover:text-amber-200'
                                }`}
                              >
                                {mode}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="mt-4 flex flex-wrap items-center gap-2">
                          <button onClick={() => wrapSelection(textareaRef.current, activePage.body, '**', '**', (next) => updateActivePage((page) => ({ ...page, body: next })), 'Bold text')} className="rounded border border-amber-800/30 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-900/20 cursor-pointer">Bold</button>
                          <button onClick={() => wrapSelection(textareaRef.current, activePage.body, '*', '*', (next) => updateActivePage((page) => ({ ...page, body: next })), 'Italic text')} className="rounded border border-amber-800/30 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-900/20 cursor-pointer">Italic</button>
                          <button onClick={() => insertAtCursor(textareaRef.current, activePage.body, '\n## New Heading\n', (next) => updateActivePage((page) => ({ ...page, body: next })))} className="rounded border border-amber-800/30 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-900/20 cursor-pointer"><FileText size={12} className="inline mr-1" />H2</button>
                          <button onClick={() => insertAtCursor(textareaRef.current, activePage.body, '\n### New Subheading\n', (next) => updateActivePage((page) => ({ ...page, body: next })))} className="rounded border border-amber-800/30 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-900/20 cursor-pointer">H3</button>
                          <button onClick={() => insertAtCursor(textareaRef.current, activePage.body, '\n| Column A | Column B |\n| --- | --- |\n| Value | Value |\n', (next) => updateActivePage((page) => ({ ...page, body: next })))} className="rounded border border-amber-800/30 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-900/20 cursor-pointer"><Table2 size={12} className="inline mr-1" />Table</button>
                          <button onClick={() => insertAtCursor(textareaRef.current, activePage.body, '\n> Lore callout text\n', (next) => updateActivePage((page) => ({ ...page, body: next })))} className="rounded border border-amber-800/30 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-900/20 cursor-pointer">Callout</button>
                          <button
                            onClick={() =>
                              insertAtCursor(
                                textareaRef.current,
                                activePage.body,
                                `<a href="#" data-go-chapter="${linkTarget || 'target-id'}"${linkTargetPart ? ` data-go-chapter-part="${linkTargetPart}"` : ''}>${linkText || 'Read more'}</a>`,
                                (next) => updateActivePage((page) => ({ ...page, body: next }))
                              )
                            }
                            className="rounded border border-amber-800/30 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-900/20 cursor-pointer"
                          >
                            <Link2 size={12} className="inline mr-1" />Link
                          </button>
                          <button
                            onClick={() => insertAtCursor(textareaRef.current, activePage.body, `\n<h2 data-part="${partId || 'new-part'}">${partLabel || 'New Section'}</h2>\n`, (next) => updateActivePage((page) => ({ ...page, body: next })))}
                            className="rounded border border-amber-800/30 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-900/20 cursor-pointer"
                          >
                            data-part
                          </button>
                          <button
                            onClick={() => activePage.assets[0] && insertAtCursor(textareaRef.current, activePage.body, `![${activePage.assets[0].file.name}](${activePage.assets[0].exportPath})`, (next) => updateActivePage((page) => ({ ...page, body: next })))}
                            disabled={activePage.assets.length === 0}
                            className="rounded border border-amber-800/30 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-900/20 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                          >
                            <FileImage size={12} className="inline mr-1" />Image
                          </button>
                          <div className="ml-auto flex items-center gap-2">
                            <label className="text-xs text-amber-600">Text size</label>
                            <select
                              value={editorTextSize}
                              onChange={(e) => setEditorTextSize(e.target.value as 'sm' | 'base' | 'lg')}
                              className="rounded-lg border border-stone-700 bg-stone-900 px-2 py-1.5 text-xs text-amber-100 focus:outline-none"
                            >
                              <option value="sm">Small</option>
                              <option value="base">Medium</option>
                              <option value="lg">Large</option>
                            </select>
                            <button
                              onClick={() => navigator.clipboard.writeText(compiledMarkdown)}
                              className="rounded border border-amber-800/30 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-900/20 cursor-pointer"
                            >
                              Copy Markdown
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className={`grid min-h-[70vh] ${canvasMode === 'split' ? 'xl:grid-cols-2' : 'grid-cols-1'}`}>
                        {canvasMode !== 'preview' && (
                          <div className="flex min-h-[32rem] flex-col border-r border-amber-800/20 bg-stone-950/65">
                            <textarea
                              ref={textareaRef}
                              value={activePage.body}
                              onChange={(e) => updateActivePage((page) => ({ ...page, body: e.target.value }))}
                              className={`min-h-[70vh] flex-1 resize-none bg-transparent px-5 py-5 ${editorTextSizeClass} text-amber-100 focus:outline-none font-mono leading-7`}
                              placeholder="Write markdown, tables, raw HTML, data-part sections, and clickable internal links here."
                            />
                          </div>
                        )}

                        {canvasMode !== 'write' && (
                          <div className="min-h-[32rem] bg-stone-900/55">
                            <div className="h-full overflow-y-auto p-4">
                              {exportError && (
                                <div className="mb-4 rounded-lg border border-red-900/30 bg-red-950/20 px-3 py-2 text-sm text-red-300">
                                  {exportError}
                                </div>
                              )}
                              <div className="rounded-[1.75rem] border border-amber-900/20 bg-stone-900/70 leather-bg p-4">
                                <div
                                  className="mx-auto transition-all duration-300"
                                  style={{
                                    width: `${Math.max(0.45, Math.min(1, Number(activePage.metadata.width) || 0.78)) * 100}%`,
                                    minWidth: canvasMode === 'split' ? '420px' : '680px',
                                  }}
                                >
                                  <MarkdownRenderer path={compiledMarkdown || '_No content yet._'} assetMap={assetMap} />
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                      <div className="space-y-4">
                        <div className="rounded-2xl border border-amber-800/30 bg-stone-900/40 p-4">
                          <div className="mb-3 flex items-center justify-between">
                            <h3 className="text-sm font-bold uppercase tracking-[0.2em] text-amber-500" style={{ fontFamily: "'Cinzel', serif" }}>
                              Page Settings
                            </h3>
                            <button
                              onClick={() =>
                                updateActivePage((page) => ({
                                  ...page,
                                  metadata: {
                                    ...page.metadata,
                                    id: page.metadata.title.trim() ? slugify(page.metadata.title) : page.metadata.id,
                                  },
                                }))
                              }
                              className="rounded border border-amber-800/30 px-2 py-1 text-xs text-amber-300 hover:bg-amber-900/20 cursor-pointer"
                            >
                              Auto id
                            </button>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="col-span-2">
                              <label className="mb-1 block text-xs text-amber-600">Title</label>
                              <input value={activePage.metadata.title} onChange={(e) => updateActivePage((page) => ({ ...page, metadata: { ...page.metadata, title: e.target.value } }))} className="w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-amber-100 focus:border-amber-500/50 focus:outline-none" />
                            </div>
                            <div className="col-span-2">
                              <label className="mb-1 block text-xs text-amber-600">Page ID</label>
                              <input value={activePage.metadata.id} onChange={(e) => updateActivePage((page) => ({ ...page, metadata: { ...page.metadata, id: slugify(e.target.value) } }))} className="w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-amber-100 focus:border-amber-500/50 focus:outline-none" />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs text-amber-600">System</label>
                              <select value={activePage.metadata.system} onChange={(e) => updateActivePage((page) => ({ ...page, metadata: { ...page.metadata, system: e.target.value as GameSystemId } }))} className="w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-amber-100 focus:border-amber-500/50 focus:outline-none">
                                <option value="inoraxium">Inoraxium</option>
                                <option value="horaghfus">Horaghfus</option>
                              </select>
                            </div>
                            <div>
                              <label className="mb-1 block text-xs text-amber-600">Preview width</label>
                              <input value={activePage.metadata.width} onChange={(e) => updateActivePage((page) => ({ ...page, metadata: { ...page.metadata, width: e.target.value } }))} className="w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-amber-100 focus:border-amber-500/50 focus:outline-none" />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs text-amber-600">Subtitle</label>
                              <input value={activePage.metadata.subtitle} onChange={(e) => updateActivePage((page) => ({ ...page, metadata: { ...page.metadata, subtitle: e.target.value } }))} className="w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-amber-100 focus:border-amber-500/50 focus:outline-none" />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs text-amber-600">Icon</label>
                              <input value={activePage.metadata.icon} onChange={(e) => updateActivePage((page) => ({ ...page, metadata: { ...page.metadata, icon: e.target.value } }))} className="w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-amber-100 focus:border-amber-500/50 focus:outline-none" />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs text-amber-600">Parent ID</label>
                              <input value={activePage.metadata.parentId} onChange={(e) => updateActivePage((page) => ({ ...page, metadata: { ...page.metadata, parentId: e.target.value } }))} className="w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-amber-100 focus:border-amber-500/50 focus:outline-none" />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs text-amber-600">Order</label>
                              <input value={activePage.metadata.order} onChange={(e) => updateActivePage((page) => ({ ...page, metadata: { ...page.metadata, order: e.target.value } }))} className="w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-amber-100 focus:border-amber-500/50 focus:outline-none" />
                            </div>
                            <label className="col-span-2 flex items-center gap-2 text-sm text-amber-200">
                              <input type="checkbox" checked={activePage.metadata.sidebarVisible} onChange={(e) => updateActivePage((page) => ({ ...page, metadata: { ...page.metadata, sidebarVisible: e.target.checked } }))} />
                              Show this page in the sidebar when published
                            </label>
                          </div>
                        </div>

                        <div className="rounded-2xl border border-amber-800/30 bg-stone-900/40 p-4">
                          <h3 className="mb-3 text-sm font-bold uppercase tracking-[0.2em] text-amber-500" style={{ fontFamily: "'Cinzel', serif" }}>
                            Quick Inserts
                          </h3>
                          <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-2">
                              <input value={partId} onChange={(e) => setPartId(slugify(e.target.value) || e.target.value)} placeholder="part-id" className="rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-amber-100 focus:outline-none" />
                              <input value={partLabel} onChange={(e) => setPartLabel(e.target.value)} placeholder="Part title" className="rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-amber-100 focus:outline-none" />
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                              <input value={linkText} onChange={(e) => setLinkText(e.target.value)} placeholder="Link text" className="rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-amber-100 focus:outline-none" />
                              <input value={linkTarget} onChange={(e) => setLinkTarget(e.target.value)} placeholder="target-id" className="rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-amber-100 focus:outline-none" />
                              <input value={linkTargetPart} onChange={(e) => setLinkTargetPart(e.target.value)} placeholder="target-part" className="rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-amber-100 focus:outline-none" />
                            </div>
                            <p className="text-xs text-stone-500">Keep these fields filled while you write. The toolbar buttons above use them directly.</p>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="rounded-2xl border border-amber-800/30 bg-stone-900/40 p-4">
                          <div className="mb-3 flex items-center justify-between">
                            <h3 className="text-sm font-bold uppercase tracking-[0.2em] text-amber-500" style={{ fontFamily: "'Cinzel', serif" }}>
                              Uploaded Assets
                            </h3>
                            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-amber-700/40 bg-amber-900/20 px-3 py-1.5 text-xs text-amber-200 hover:bg-amber-900/40">
                              <FileImage size={14} /> Upload
                              <input type="file" multiple accept="image/*" className="hidden" onChange={(e) => handleAssetUpload(e.target.files)} />
                            </label>
                          </div>
                          <div className="space-y-2">
                            {activePage.assets.length === 0 && <p className="text-xs text-stone-500">Images are attached per page and included in the export ZIP.</p>}
                            {activePage.assets.map((asset) => (
                              <div key={asset.id} className="rounded-lg border border-stone-800 bg-black/20 p-2">
                                <div className="flex items-center gap-2">
                                  <img src={asset.objectUrl} alt={asset.file.name} className="h-10 w-10 rounded object-cover" />
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm text-amber-200">{asset.file.name}</p>
                                    <p className="truncate text-[11px] text-amber-600">{asset.exportPath}</p>
                                  </div>
                                  <button onClick={() => removeAsset(asset.id)} className="text-red-400 hover:text-red-300 cursor-pointer"><Trash2 size={14} /></button>
                                </div>
                                <div className="mt-2 flex gap-2">
                                  <button onClick={() => insertAtCursor(textareaRef.current, activePage.body, `![${asset.file.name}](${asset.exportPath})`, (next) => updateActivePage((page) => ({ ...page, body: next })))} className="rounded border border-amber-800/30 px-2 py-1 text-[11px] text-amber-300 hover:bg-amber-900/20 cursor-pointer">Insert image</button>
                                  <button onClick={() => updateActivePage((page) => ({ ...page, infobox: { ...page.infobox, enabled: true, imagePath: asset.exportPath, imageAlt: page.infobox.imageAlt || page.metadata.title } }))} className="rounded border border-amber-800/30 px-2 py-1 text-[11px] text-amber-300 hover:bg-amber-900/20 cursor-pointer">Use in infobox</button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="rounded-2xl border border-amber-800/30 bg-stone-900/40 p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <h3 className="text-sm font-bold uppercase tracking-[0.2em] text-amber-500" style={{ fontFamily: "'Cinzel', serif" }}>
                          Infobox Builder
                        </h3>
                        <label className="flex items-center gap-2 text-amber-200">
                          <input
                            type="checkbox"
                            checked={activePage.infobox.enabled}
                            onChange={(e) =>
                              updateActivePage((page) => ({
                                ...page,
                                infobox: { ...page.infobox, enabled: e.target.checked },
                              }))
                            }
                          />
                          Enabled
                        </label>
                      </div>

                      {activePage.infobox.enabled ? (
                        <div className="space-y-3 text-sm">
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="mb-1 block text-xs text-amber-600">Infobox image path</label>
                              <input
                                value={activePage.infobox.imagePath}
                                onChange={(e) =>
                                  updateActivePage((page) => ({
                                    ...page,
                                    infobox: { ...page.infobox, imagePath: e.target.value },
                                  }))
                                }
                                className="w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-amber-100 focus:outline-none"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs text-amber-600">Image alt</label>
                              <input
                                value={activePage.infobox.imageAlt}
                                onChange={(e) =>
                                  updateActivePage((page) => ({
                                    ...page,
                                    infobox: { ...page.infobox, imageAlt: e.target.value },
                                  }))
                                }
                                className="w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-amber-100 focus:outline-none"
                              />
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="mb-1 block text-xs text-amber-600">Title background</label>
                              <input type="color" value={activePage.infobox.titleBackgroundColor} onChange={(e) => updateActivePage((page) => ({ ...page, infobox: { ...page.infobox, titleBackgroundColor: e.target.value } }))} className="h-10 w-full rounded-lg border border-stone-700 bg-stone-900 p-1" />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs text-amber-600">Title text</label>
                              <input type="color" value={activePage.infobox.titleTextColor} onChange={(e) => updateActivePage((page) => ({ ...page, infobox: { ...page.infobox, titleTextColor: e.target.value } }))} className="h-10 w-full rounded-lg border border-stone-700 bg-stone-900 p-1" />
                            </div>
                          </div>

                          {activePage.infobox.sections.map((section, sectionIndex) => (
                            <div key={section.id} className="rounded-xl border border-amber-800/20 bg-black/20 p-3 space-y-3">
                              <div className="flex items-center justify-between">
                                <p className="text-sm font-bold text-amber-300">Section {sectionIndex + 1}</p>
                                <button
                                  onClick={() =>
                                    updateActivePage((page) => ({
                                      ...page,
                                      infobox: {
                                        ...page.infobox,
                                        sections: page.infobox.sections.filter((item) => item.id !== section.id),
                                      },
                                    }))
                                  }
                                  className="text-red-400 hover:text-red-300 cursor-pointer"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <input value={section.title} onChange={(e) => upsertInfoboxSection(section.id, (current) => ({ ...current, title: e.target.value }))} placeholder="Section title" className="rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-amber-100 focus:outline-none" />
                                <label className="flex items-center gap-2 rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-amber-100">
                                  <input type="checkbox" checked={section.defaultOpen} onChange={(e) => upsertInfoboxSection(section.id, (current) => ({ ...current, defaultOpen: e.target.checked }))} />
                                  Default open
                                </label>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="mb-1 block text-xs text-amber-600">Header bg</label>
                                  <input type="color" value={section.color} onChange={(e) => upsertInfoboxSection(section.id, (current) => ({ ...current, color: e.target.value }))} className="h-10 w-full rounded-lg border border-stone-700 bg-stone-900 p-1" />
                                </div>
                                <div>
                                  <label className="mb-1 block text-xs text-amber-600">Header text</label>
                                  <input type="color" value={section.titleColor} onChange={(e) => upsertInfoboxSection(section.id, (current) => ({ ...current, titleColor: e.target.value }))} className="h-10 w-full rounded-lg border border-stone-700 bg-stone-900 p-1" />
                                </div>
                                <div>
                                  <label className="mb-1 block text-xs text-amber-600">Entry background</label>
                                  <input type="color" value={section.entryBackgroundColor} onChange={(e) => upsertInfoboxSection(section.id, (current) => ({ ...current, entryBackgroundColor: e.target.value }))} className="h-10 w-full rounded-lg border border-stone-700 bg-stone-900 p-1" />
                                </div>
                                <div>
                                  <label className="mb-1 block text-xs text-amber-600">Label color</label>
                                  <input type="color" value={section.labelColor} onChange={(e) => upsertInfoboxSection(section.id, (current) => ({ ...current, labelColor: e.target.value }))} className="h-10 w-full rounded-lg border border-stone-700 bg-stone-900 p-1" />
                                </div>
                                <div>
                                  <label className="mb-1 block text-xs text-amber-600">Value color</label>
                                  <input type="color" value={section.valueColor} onChange={(e) => upsertInfoboxSection(section.id, (current) => ({ ...current, valueColor: e.target.value }))} className="h-10 w-full rounded-lg border border-stone-700 bg-stone-900 p-1" />
                                </div>
                              </div>
                              <div className="space-y-2">
                                {section.entries.map((entry, entryIndex) => (
                                  <div key={entry.id} className="rounded-lg border border-stone-800 bg-stone-950/60 p-2">
                                    <div className="mb-2 flex items-center justify-between">
                                      <p className="text-xs text-amber-500">Entry {entryIndex + 1}</p>
                                      <button
                                        onClick={() =>
                                          upsertInfoboxSection(section.id, (current) => ({
                                            ...current,
                                            entries: current.entries.filter((item) => item.id !== entry.id),
                                          }))
                                        }
                                        className="text-red-400 hover:text-red-300 cursor-pointer"
                                      >
                                        <Trash2 size={12} />
                                      </button>
                                    </div>
                                    <input
                                      value={entry.label}
                                      onChange={(e) =>
                                        upsertInfoboxSection(section.id, (current) => ({
                                          ...current,
                                          entries: current.entries.map((item) => item.id === entry.id ? { ...item, label: e.target.value } : item),
                                        }))
                                      }
                                      placeholder="Entry label"
                                      className="mb-2 w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-amber-100 focus:outline-none"
                                    />
                                    <textarea
                                      value={entry.value}
                                      onChange={(e) =>
                                        upsertInfoboxSection(section.id, (current) => ({
                                          ...current,
                                          entries: current.entries.map((item) => item.id === entry.id ? { ...item, value: e.target.value } : item),
                                        }))
                                      }
                                      rows={3}
                                      placeholder="Entry value (markdown and links supported)"
                                      className="w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-amber-100 focus:outline-none"
                                    />
                                  </div>
                                ))}
                                <button
                                  onClick={() =>
                                    upsertInfoboxSection(section.id, (current) => ({
                                      ...current,
                                      entries: [...current.entries, { id: createId(), label: 'New label', value: 'New value' }],
                                    }))
                                  }
                                  className="flex items-center gap-2 rounded-lg border border-amber-700/30 px-3 py-2 text-xs text-amber-300 hover:bg-amber-900/20 cursor-pointer"
                                >
                                  <Plus size={12} /> Add entry
                                </button>
                              </div>
                            </div>
                          ))}

                          <button
                            onClick={() =>
                              updateActivePage((page) => ({
                                ...page,
                                infobox: {
                                  ...page.infobox,
                                  sections: [...page.infobox.sections, createDefaultInfoboxSection(page.metadata.system)],
                                },
                              }))
                            }
                            className="flex items-center gap-2 rounded-lg border border-amber-700/40 bg-amber-900/20 px-3 py-2 text-sm text-amber-200 hover:bg-amber-900/40 cursor-pointer"
                          >
                            <Plus size={14} /> Add infobox section
                          </button>
                        </div>
                      ) : (
                        <p className="text-xs text-stone-500">Enable the infobox to add a wiki-style info card to this page.</p>
                      )}
                    </div>
                        </div>
                      </div>
                    </div>
                )}
              </section>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};
