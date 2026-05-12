import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bold,
  Download,
  FileImage,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Plus,
  Table2,
  Trash2,
} from 'lucide-react';
import MarkdownRenderer from './MarkdownRenderer';
import { GameSystemId } from '../types';
import { createZip, stringToBytes } from '../utils/zip';

interface VisualPageEditorProps {
  currentSystem: GameSystemId;
  onExit: () => void;
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

interface TableDraft {
  className: string;
  headers: string[];
  rows: string[][];
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
  entries: [{ id: createId(), label: 'Example label', value: 'Example value' }],
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
  body: '<p>Start writing here...</p>',
  infobox: createDefaultInfoboxDraft(system),
  assets: [],
});

const createDefaultTableDraft = (): TableDraft => ({
  className: 'tableRow',
  headers: ['Column A', 'Column B'],
  rows: [
    ['Value', 'Value'],
    ['Value', 'Value'],
  ],
});

const buildTableHtml = (table: TableDraft) => {
  const headerCells = table.headers
    .map((header) => `<th>${header || 'Column'}</th>`)
    .join('');
  const rowMarkup = table.rows
    .map((row) => `<tr>${row.map((cell) => `<td>${cell || ''}</td>`).join('')}</tr>`)
    .join('');

  return `<table class="${table.className}"><thead><tr>${headerCells}</tr></thead><tbody>${rowMarkup}</tbody></table>`;
};

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

export const VisualPageEditor: React.FC<VisualPageEditorProps> = ({ currentSystem, onExit }) => {
  const [pages, setPages] = useState<EditorPageDraft[]>(() => [createDefaultPageDraft(currentSystem)]);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<'visual' | 'source' | 'preview'>('visual');
  const [linkText, setLinkText] = useState('Read more');
  const [linkTarget, setLinkTarget] = useState('');
  const [linkTargetPart, setLinkTargetPart] = useState('');
  const [partId, setPartId] = useState('new-part');
  const [partLabel, setPartLabel] = useState('New Section');
  const [exportError, setExportError] = useState('');
  const [tableDraft, setTableDraft] = useState<TableDraft>(createDefaultTableDraft);

  const editorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!activePageId && pages[0]) {
      setActivePageId(pages[0].pageId);
    }
  }, [activePageId, pages]);

  useEffect(() => () => {
    pages.forEach((page) => page.assets.forEach((asset) => URL.revokeObjectURL(asset.objectUrl)));
  }, [pages]);

  const activePage = useMemo(
    () => pages.find((page) => page.pageId === activePageId) ?? pages[0] ?? null,
    [activePageId, pages]
  );

  const assetMap = useMemo(
    () => Object.fromEntries((activePage?.assets ?? []).map((asset) => [asset.exportPath, asset.objectUrl])),
    [activePage]
  );

  const compiledMarkdown = useMemo(
    () => (activePage ? buildCompiledMarkdown(activePage) : ''),
    [activePage]
  );

  const pageIdsInWorkspace = useMemo(
    () => pages.map((page) => page.metadata.id.trim()).filter(Boolean).sort(),
    [pages]
  );

  useEffect(() => {
    if (!editorRef.current || !activePage || editorMode !== 'visual') return;
    if (editorRef.current.innerHTML !== activePage.body) {
      editorRef.current.innerHTML = activePage.body;
    }
  }, [activePage?.pageId, activePage?.body, editorMode]);

  const updateActivePage = (updater: (page: EditorPageDraft) => EditorPageDraft) => {
    if (!activePage) return;
    setPages((prev) => prev.map((page) => (page.pageId === activePage.pageId ? updater(page) : page)));
  };

  const addNewPage = () => {
    const next = createDefaultPageDraft(currentSystem, pages.length + 1);
    setPages((prev) => [...prev, next]);
    setActivePageId(next.pageId);
  };

  const duplicateActivePage = () => {
    if (!activePage) return;
    const clonedAssets = activePage.assets.map((asset) => ({
      ...asset,
      id: createId(),
      objectUrl: URL.createObjectURL(asset.file),
    }));

    const copy: EditorPageDraft = {
      pageId: createId(),
      metadata: {
        ...activePage.metadata,
        id: activePage.metadata.id ? `${activePage.metadata.id}-copy` : '',
        title: `${activePage.metadata.title} Copy`,
      },
      body: activePage.body,
      infobox: {
        ...activePage.infobox,
        sections: activePage.infobox.sections.map((section) => ({
          ...section,
          id: createId(),
          entries: section.entries.map((entry) => ({ ...entry, id: createId() })),
        })),
      },
      assets: clonedAssets,
    };

    setPages((prev) => [...prev, copy]);
    setActivePageId(copy.pageId);
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

  const syncEditorBody = () => {
    if (!editorRef.current) return;
    updateActivePage((page) => ({ ...page, body: editorRef.current?.innerHTML || '' }));
  };

  const focusEditor = () => {
    editorRef.current?.focus();
  };

  const exec = (command: string, value?: string) => {
    focusEditor();
    document.execCommand(command, false, value);
    syncEditorBody();
  };

  const insertHtml = (html: string) => {
    if (editorMode === 'visual') {
      focusEditor();
      document.execCommand('insertHTML', false, html);
      syncEditorBody();
      return;
    }

    updateActivePage((page) => ({
      ...page,
      body: `${page.body}${page.body.endsWith('\n') ? '' : '\n'}${html}`,
    }));
  };

  const applyHeading = (tag: 'H2' | 'H3') => {
    focusEditor();
    document.execCommand('formatBlock', false, tag);
    syncEditorBody();
  };

  const insertDataPartHeading = () => {
    insertHtml(`<h2 data-part="${partId || 'new-part'}">${partLabel || 'New Section'}</h2>`);
  };

  const insertChapterLink = () => {
    insertHtml(
      `<a href="#" data-go-chapter="${linkTarget || 'target-id'}"${linkTargetPart ? ` data-go-chapter-part="${linkTargetPart}"` : ''}>${linkText || 'Read more'}</a>`
    );
  };

  const insertBuiltTable = () => {
    insertHtml(buildTableHtml(tableDraft));
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

  const updateTableHeader = (index: number, value: string) => {
    setTableDraft((prev) => ({
      ...prev,
      headers: prev.headers.map((header, headerIndex) => (headerIndex === index ? value : header)),
      rows: prev.rows.map((row) => {
        if (row.length < prev.headers.length) {
          return [...row, ...Array.from({ length: prev.headers.length - row.length }, () => '')];
        }
        return row;
      }),
    }));
  };

  const updateTableCell = (rowIndex: number, columnIndex: number, value: string) => {
    setTableDraft((prev) => ({
      ...prev,
      rows: prev.rows.map((row, currentRowIndex) =>
        currentRowIndex === rowIndex
          ? row.map((cell, currentColumnIndex) => (currentColumnIndex === columnIndex ? value : cell))
          : row
      ),
    }));
  };

  const addTableColumn = () => {
    setTableDraft((prev) => ({
      ...prev,
      headers: [...prev.headers, `Column ${prev.headers.length + 1}`],
      rows: prev.rows.map((row) => [...row, '']),
    }));
  };

  const removeTableColumn = () => {
    setTableDraft((prev) => {
      if (prev.headers.length <= 1) return prev;
      return {
        ...prev,
        headers: prev.headers.slice(0, -1),
        rows: prev.rows.map((row) => row.slice(0, -1)),
      };
    });
  };

  const addTableRow = () => {
    setTableDraft((prev) => ({
      ...prev,
      rows: [...prev.rows, prev.headers.map(() => '')],
    }));
  };

  const removeTableRow = () => {
    setTableDraft((prev) => {
      if (prev.rows.length <= 1) return prev;
      return {
        ...prev,
        rows: prev.rows.slice(0, -1),
      };
    });
  };

  const exportWorkspace = async () => {
    try {
      setExportError('');

      const normalizedPages = pages.map((page, index) => {
        const id = page.metadata.id.trim() || slugify(page.metadata.title) || `page-${index + 1}`;
        return { ...page, metadata: { ...page.metadata, id } };
      });

      const manifest = {
        version: 2,
        exportedAt: new Date().toISOString(),
        pageCount: normalizedPages.length,
        pages: normalizedPages.map((page) => ({
          metadata: { ...page.metadata, hiddenButLinkable: !page.metadata.sidebarVisible },
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

  if (!activePage) return null;

  return (
    <div className="flex-1 overflow-y-auto bg-stone-800/30">
      <div className="mx-auto max-w-[1700px] px-6 py-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-800/30 bg-stone-900/55 px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <button onClick={onExit} className="rounded-lg border border-amber-800/30 px-3 py-2 text-amber-300 hover:bg-amber-900/20 cursor-pointer">
                <ArrowLeft size={14} className="inline mr-1" /> Back to reading
              </button>
              <span className="text-xs uppercase tracking-[0.2em] text-amber-600" style={{ fontFamily: "'Cinzel', serif" }}>
                Visual Wiki Editor
              </span>
            </div>
            <h2 className="mt-2 text-2xl font-bold text-amber-300" style={{ fontFamily: "'Cinzel', serif" }}>
              Page Workspace
            </h2>
            <p className="text-sm text-amber-600">Click directly on the page canvas and write like a wiki editor.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={addNewPage} className="rounded-lg border border-amber-700/40 bg-amber-900/20 px-4 py-2 text-sm font-bold text-amber-100 hover:bg-amber-900/35 cursor-pointer">
              <Plus size={14} className="inline mr-1" /> New Page
            </button>
            <button onClick={duplicateActivePage} className="rounded-lg border border-amber-700/40 bg-amber-900/20 px-4 py-2 text-sm font-bold text-amber-100 hover:bg-amber-900/35 cursor-pointer">
              Duplicate
            </button>
            <button onClick={exportWorkspace} className="rounded-lg border border-emerald-700/50 bg-emerald-900/30 px-4 py-2 text-sm font-bold text-emerald-200 hover:bg-emerald-900/45 cursor-pointer">
              <Download size={14} className="inline mr-1" /> Export Workspace ZIP
            </button>
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-[19rem_minmax(0,1fr)_23rem]">
          <aside className="rounded-2xl border border-amber-800/30 bg-stone-900/50 p-4">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-amber-600" style={{ fontFamily: "'Cinzel', serif" }}>
                  Created Pages
                </p>
                <p className="text-[11px] text-amber-300/70">{pages.length} page(s) in this export</p>
              </div>
              <button onClick={addNewPage} className="rounded-lg border border-amber-700/40 bg-amber-900/20 p-2 text-amber-200 hover:bg-amber-900/40 cursor-pointer">
                <Plus size={14} />
              </button>
            </div>

            <div className="space-y-2">
              {pages.map((page, index) => {
                const active = page.pageId === activePage.pageId;
                return (
                  <button
                    key={page.pageId}
                    onClick={() => setActivePageId(page.pageId)}
                    className={`w-full rounded-xl border p-3 text-left transition-colors cursor-pointer ${
                      active ? 'border-amber-500/50 bg-amber-900/25' : 'border-stone-800/70 bg-black/20 hover:border-stone-700 hover:bg-amber-950/10'
                    }`}
                  >
                    <div className="truncate text-sm font-bold text-amber-200" style={{ fontFamily: "'Cinzel', serif" }}>
                      {page.metadata.title || `Untitled ${index + 1}`}
                    </div>
                    <div className="truncate text-[11px] text-amber-600">{page.metadata.id || 'No id yet'}</div>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 space-y-2 border-t border-amber-800/20 pt-4">
              <button onClick={() => removePage(activePage.pageId)} className="flex w-full items-center gap-2 rounded-lg border border-red-800/30 bg-red-950/15 px-3 py-2 text-sm text-red-300 hover:bg-red-950/25 cursor-pointer">
                <Trash2 size={14} /> Delete current page
              </button>
              <div className="rounded-lg border border-stone-800 bg-black/20 p-3 text-xs text-stone-400">
                Workspace page ids:
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
          </aside>

          <section className="space-y-4">
            <div className="rounded-2xl border border-amber-800/30 bg-stone-900/55 overflow-hidden">
              <div className="border-b border-amber-800/20 px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <input
                      value={activePage.metadata.title}
                      onChange={(e) => updateActivePage((page) => ({ ...page, metadata: { ...page.metadata, title: e.target.value } }))}
                      className="w-full bg-transparent text-4xl font-bold text-amber-300 focus:outline-none"
                      style={{ fontFamily: "'Cinzel', serif" }}
                    />
                    <input
                      value={activePage.metadata.subtitle}
                      onChange={(e) => updateActivePage((page) => ({ ...page, metadata: { ...page.metadata, subtitle: e.target.value } }))}
                      placeholder="Add a subtitle..."
                      className="mt-2 w-full bg-transparent text-lg italic text-amber-600 focus:outline-none"
                      style={{ fontFamily: "'IM Fell English', serif" }}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    {(['visual', 'source', 'preview'] as const).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => setEditorMode(mode)}
                        className={`rounded-lg border px-3 py-1.5 text-xs font-bold uppercase tracking-wide cursor-pointer ${
                          editorMode === mode
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
                  <button onClick={() => exec('bold')} className="rounded border border-amber-800/30 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-900/20 cursor-pointer"><Bold size={12} className="inline mr-1" />Bold</button>
                  <button onClick={() => exec('italic')} className="rounded border border-amber-800/30 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-900/20 cursor-pointer"><Italic size={12} className="inline mr-1" />Italic</button>
                  <button onClick={() => applyHeading('H2')} className="rounded border border-amber-800/30 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-900/20 cursor-pointer"><Heading2 size={12} className="inline mr-1" />Heading</button>
                  <button onClick={() => applyHeading('H3')} className="rounded border border-amber-800/30 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-900/20 cursor-pointer"><Heading3 size={12} className="inline mr-1" />Subheading</button>
                  <button onClick={() => exec('insertUnorderedList')} className="rounded border border-amber-800/30 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-900/20 cursor-pointer"><List size={12} className="inline mr-1" />Bullets</button>
                  <button onClick={() => exec('insertOrderedList')} className="rounded border border-amber-800/30 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-900/20 cursor-pointer"><ListOrdered size={12} className="inline mr-1" />Numbers</button>
                  <button onClick={() => insertHtml('<blockquote><p>Lore callout text</p></blockquote>')} className="rounded border border-amber-800/30 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-900/20 cursor-pointer">Callout</button>
                  <button onClick={insertBuiltTable} className="rounded border border-amber-800/30 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-900/20 cursor-pointer"><Table2 size={12} className="inline mr-1" />Table</button>
                  <button onClick={insertChapterLink} className="rounded border border-amber-800/30 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-900/20 cursor-pointer"><Link2 size={12} className="inline mr-1" />Link</button>
                  <button onClick={insertDataPartHeading} className="rounded border border-amber-800/30 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-900/20 cursor-pointer">data-part</button>
                  <button
                    onClick={() => activePage.assets[0] && insertHtml(`<img src="${activePage.assets[0].exportPath}" alt="${activePage.assets[0].file.name}" />`)}
                    disabled={activePage.assets.length === 0}
                    className="rounded border border-amber-800/30 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-900/20 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <ImagePlus size={12} className="inline mr-1" />Image
                  </button>
                </div>
              </div>

              {editorMode === 'visual' && (
                <div className="editor-canvas-shell leather-bg min-h-[78vh] p-6">
                  <div className="mx-auto" style={{ width: `${Math.max(0.45, Math.min(1, Number(activePage.metadata.width) || 0.78)) * 100}%`, minWidth: '680px' }}>
                    <div
                      ref={editorRef}
                      className="editor-canvas min-h-[70vh] rounded-[1.75rem] border border-amber-900/20 bg-stone-900/70 px-8 py-8 focus:outline-none"
                      contentEditable
                      suppressContentEditableWarning
                      onInput={syncEditorBody}
                    />
                  </div>
                </div>
              )}

              {editorMode === 'source' && (
                <textarea
                  value={activePage.body}
                  onChange={(e) => updateActivePage((page) => ({ ...page, body: e.target.value }))}
                  className="min-h-[78vh] w-full resize-none bg-stone-950 px-5 py-5 text-amber-100 focus:outline-none font-mono"
                />
              )}

              {editorMode === 'preview' && (
                <div className="editor-canvas-shell leather-bg min-h-[78vh] p-6">
                  <div className="mx-auto" style={{ width: `${Math.max(0.45, Math.min(1, Number(activePage.metadata.width) || 0.78)) * 100}%`, minWidth: '680px' }}>
                    <div className="min-h-[70vh] rounded-[1.75rem] border border-amber-900/20 bg-stone-900/70 px-8 py-8">
                      <MarkdownRenderer path={compiledMarkdown || '_No content yet._'} assetMap={assetMap} />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {exportError && (
              <div className="rounded-lg border border-red-900/30 bg-red-950/20 px-3 py-2 text-sm text-red-300">
                {exportError}
              </div>
            )}
          </section>

          <aside className="space-y-4">
            <div className="rounded-2xl border border-amber-800/30 bg-stone-900/50 p-4">
              <h3 className="mb-3 text-sm font-bold uppercase tracking-[0.2em] text-amber-500" style={{ fontFamily: "'Cinzel', serif" }}>
                Link + Section Tools
              </h3>
              <div className="space-y-3">
                <input value={linkText} onChange={(e) => setLinkText(e.target.value)} placeholder="Link text" className="w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-amber-100 focus:outline-none" />
                <input value={linkTarget} onChange={(e) => setLinkTarget(e.target.value)} placeholder="target-id" className="w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-amber-100 focus:outline-none" />
                <input value={linkTargetPart} onChange={(e) => setLinkTargetPart(e.target.value)} placeholder="target-part (optional)" className="w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-amber-100 focus:outline-none" />
                <input value={partId} onChange={(e) => setPartId(slugify(e.target.value) || e.target.value)} placeholder="data-part id" className="w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-amber-100 focus:outline-none" />
                <input value={partLabel} onChange={(e) => setPartLabel(e.target.value)} placeholder="data-part label" className="w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-amber-100 focus:outline-none" />
              </div>
            </div>

            <div className="rounded-2xl border border-amber-800/30 bg-stone-900/50 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-bold uppercase tracking-[0.2em] text-amber-500" style={{ fontFamily: "'Cinzel', serif" }}>
                  Table Builder
                </h3>
                <button
                  onClick={insertBuiltTable}
                  className="rounded border border-amber-800/30 px-2 py-1 text-xs text-amber-300 hover:bg-amber-900/20 cursor-pointer"
                >
                  Insert Table
                </button>
              </div>
              <div className="space-y-3">
                <select
                  value={tableDraft.className}
                  onChange={(e) => setTableDraft((prev) => ({ ...prev, className: e.target.value }))}
                  className="w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-amber-100 focus:outline-none"
                >
                  <option value="tableRow">Default Table</option>
                  <option value="spell-card">Spell Card</option>
                  <option value="monster-stat-block">Monster Stat Block</option>
                  <option value="dwarven-table">Dwarven Table</option>
                  <option value="elven-table">Elven Table</option>
                  <option value="draconic-table">Draconic Table</option>
                  <option value="orc-table-warrior">Orc Warrior Table</option>
                  <option value="orc-table-necro">Orc Necro Table</option>
                  <option value="orc-table-monk">Orc Monk Table</option>
                  <option value="scroll-table">Scroll Table</option>
                </select>

                <div className="flex flex-wrap gap-2">
                  <button onClick={addTableColumn} className="rounded border border-amber-800/30 px-2 py-1 text-xs text-amber-300 hover:bg-amber-900/20 cursor-pointer">Add column</button>
                  <button onClick={removeTableColumn} className="rounded border border-amber-800/30 px-2 py-1 text-xs text-amber-300 hover:bg-amber-900/20 cursor-pointer">Remove column</button>
                  <button onClick={addTableRow} className="rounded border border-amber-800/30 px-2 py-1 text-xs text-amber-300 hover:bg-amber-900/20 cursor-pointer">Add row</button>
                  <button onClick={removeTableRow} className="rounded border border-amber-800/30 px-2 py-1 text-xs text-amber-300 hover:bg-amber-900/20 cursor-pointer">Remove row</button>
                </div>

                <div className="overflow-x-auto rounded-lg border border-stone-800">
                  <table className="min-w-full border-collapse">
                    <thead className="bg-stone-950/70">
                      <tr>
                        {tableDraft.headers.map((header, index) => (
                          <th key={`header-${index}`} className="border border-stone-800 p-2">
                            <input
                              value={header}
                              onChange={(e) => updateTableHeader(index, e.target.value)}
                              className="w-full rounded border border-stone-700 bg-stone-900 px-2 py-1 text-xs text-amber-100 focus:outline-none"
                            />
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tableDraft.rows.map((row, rowIndex) => (
                        <tr key={`row-${rowIndex}`} className="bg-black/15">
                          {row.map((cell, columnIndex) => (
                            <td key={`cell-${rowIndex}-${columnIndex}`} className="border border-stone-800 p-2">
                              <input
                                value={cell}
                                onChange={(e) => updateTableCell(rowIndex, columnIndex, e.target.value)}
                                className="w-full rounded border border-stone-700 bg-stone-900 px-2 py-1 text-xs text-amber-100 focus:outline-none"
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <p className="text-xs text-stone-500">
                  Build the table here, then click `Insert Table`. No markdown or HTML needed.
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-amber-800/30 bg-stone-900/50 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-bold uppercase tracking-[0.2em] text-amber-500" style={{ fontFamily: "'Cinzel', serif" }}>
                  Assets
                </h3>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-amber-700/40 bg-amber-900/20 px-3 py-1.5 text-xs text-amber-200 hover:bg-amber-900/40">
                  <FileImage size={14} /> Upload
                  <input type="file" multiple accept="image/*" className="hidden" onChange={(e) => handleAssetUpload(e.target.files)} />
                </label>
              </div>
              <div className="space-y-2">
                {activePage.assets.length === 0 && <p className="text-xs text-stone-500">Uploaded images can be inserted directly into the page or infobox.</p>}
                {activePage.assets.map((asset) => (
                  <div key={asset.id} className="rounded-lg border border-stone-800 bg-black/20 p-2">
                    <div className="flex items-center gap-2">
                      <img src={asset.objectUrl} alt={asset.file.name} className="h-10 w-10 rounded object-cover" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-amber-200">{asset.file.name}</p>
                        <p className="truncate text-[11px] text-amber-600">{asset.exportPath}</p>
                      </div>
                      <button onClick={() => removeAsset(asset.id)} className="text-red-400 hover:text-red-300 cursor-pointer">
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="mt-2 flex gap-2">
                      <button onClick={() => insertHtml(`<img src="${asset.exportPath}" alt="${asset.file.name}" />`)} className="rounded border border-amber-800/30 px-2 py-1 text-[11px] text-amber-300 hover:bg-amber-900/20 cursor-pointer">Insert</button>
                      <button
                        onClick={() =>
                          updateActivePage((page) => ({
                            ...page,
                            infobox: {
                              ...page.infobox,
                              enabled: true,
                              imagePath: asset.exportPath,
                              imageAlt: page.infobox.imageAlt || page.metadata.title,
                            },
                          }))
                        }
                        className="rounded border border-amber-800/30 px-2 py-1 text-[11px] text-amber-300 hover:bg-amber-900/20 cursor-pointer"
                      >
                        Infobox
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-amber-800/30 bg-stone-900/50 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-bold uppercase tracking-[0.2em] text-amber-500" style={{ fontFamily: "'Cinzel', serif" }}>
                  Page Settings
                </h3>
                <button
                  onClick={() => updateActivePage((page) => ({ ...page, metadata: { ...page.metadata, id: slugify(page.metadata.title) || page.metadata.id } }))}
                  className="rounded border border-amber-800/30 px-2 py-1 text-xs text-amber-300 hover:bg-amber-900/20 cursor-pointer"
                >
                  Auto id
                </button>
              </div>
              <div className="space-y-3">
                <input value={activePage.metadata.id} onChange={(e) => updateActivePage((page) => ({ ...page, metadata: { ...page.metadata, id: slugify(e.target.value) } }))} placeholder="Page id" className="w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-amber-100 focus:outline-none" />
                <select value={activePage.metadata.system} onChange={(e) => updateActivePage((page) => ({ ...page, metadata: { ...page.metadata, system: e.target.value as GameSystemId } }))} className="w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-amber-100 focus:outline-none">
                  <option value="inoraxium">Inoraxium</option>
                  <option value="horaghfus">Horaghfus</option>
                </select>
                <input value={activePage.metadata.parentId} onChange={(e) => updateActivePage((page) => ({ ...page, metadata: { ...page.metadata, parentId: e.target.value } }))} placeholder="Parent id" className="w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-amber-100 focus:outline-none" />
                <input value={activePage.metadata.order} onChange={(e) => updateActivePage((page) => ({ ...page, metadata: { ...page.metadata, order: e.target.value } }))} placeholder="Order" className="w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-amber-100 focus:outline-none" />
                <input value={activePage.metadata.width} onChange={(e) => updateActivePage((page) => ({ ...page, metadata: { ...page.metadata, width: e.target.value } }))} placeholder="Preview width" className="w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-amber-100 focus:outline-none" />
                <label className="flex items-center gap-2 text-sm text-amber-200">
                  <input type="checkbox" checked={activePage.metadata.sidebarVisible} onChange={(e) => updateActivePage((page) => ({ ...page, metadata: { ...page.metadata, sidebarVisible: e.target.checked } }))} />
                  Show in sidebar when published
                </label>
              </div>
            </div>

            <div className="rounded-2xl border border-amber-800/30 bg-stone-900/50 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-bold uppercase tracking-[0.2em] text-amber-500" style={{ fontFamily: "'Cinzel', serif" }}>
                  Infobox
                </h3>
                <label className="flex items-center gap-2 text-amber-200">
                  <input type="checkbox" checked={activePage.infobox.enabled} onChange={(e) => updateActivePage((page) => ({ ...page, infobox: { ...page.infobox, enabled: e.target.checked } }))} />
                  Enabled
                </label>
              </div>
              {activePage.infobox.enabled ? (
                <div className="space-y-3 text-sm">
                  <input value={activePage.infobox.imagePath} onChange={(e) => updateActivePage((page) => ({ ...page, infobox: { ...page.infobox, imagePath: e.target.value } }))} placeholder="Infobox image path" className="w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-amber-100 focus:outline-none" />
                  <input value={activePage.infobox.imageAlt} onChange={(e) => updateActivePage((page) => ({ ...page, infobox: { ...page.infobox, imageAlt: e.target.value } }))} placeholder="Image alt" className="w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-amber-100 focus:outline-none" />
                  <div className="grid grid-cols-2 gap-2">
                    <input type="color" value={activePage.infobox.titleBackgroundColor} onChange={(e) => updateActivePage((page) => ({ ...page, infobox: { ...page.infobox, titleBackgroundColor: e.target.value } }))} className="h-10 w-full rounded-lg border border-stone-700 bg-stone-900 p-1" />
                    <input type="color" value={activePage.infobox.titleTextColor} onChange={(e) => updateActivePage((page) => ({ ...page, infobox: { ...page.infobox, titleTextColor: e.target.value } }))} className="h-10 w-full rounded-lg border border-stone-700 bg-stone-900 p-1" />
                  </div>

                  {activePage.infobox.sections.map((section) => (
                    <div key={section.id} className="rounded-xl border border-amber-800/20 bg-black/20 p-3 space-y-3">
                      <div className="flex items-center justify-between">
                        <input value={section.title} onChange={(e) => upsertInfoboxSection(section.id, (current) => ({ ...current, title: e.target.value }))} className="flex-1 rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-amber-100 focus:outline-none" />
                        <button onClick={() => updateActivePage((page) => ({ ...page, infobox: { ...page.infobox, sections: page.infobox.sections.filter((item) => item.id !== section.id) } }))} className="ml-2 text-red-400 hover:text-red-300 cursor-pointer"><Trash2 size={14} /></button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <input type="color" value={section.color} onChange={(e) => upsertInfoboxSection(section.id, (current) => ({ ...current, color: e.target.value }))} className="h-10 w-full rounded-lg border border-stone-700 bg-stone-900 p-1" />
                        <input type="color" value={section.titleColor} onChange={(e) => upsertInfoboxSection(section.id, (current) => ({ ...current, titleColor: e.target.value }))} className="h-10 w-full rounded-lg border border-stone-700 bg-stone-900 p-1" />
                      </div>
                      {section.entries.map((entry) => (
                        <div key={entry.id} className="rounded-lg border border-stone-800 bg-stone-950/60 p-2 space-y-2">
                          <input value={entry.label} onChange={(e) => upsertInfoboxSection(section.id, (current) => ({ ...current, entries: current.entries.map((item) => item.id === entry.id ? { ...item, label: e.target.value } : item) }))} placeholder="Entry label" className="w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-amber-100 focus:outline-none" />
                          <textarea value={entry.value} onChange={(e) => upsertInfoboxSection(section.id, (current) => ({ ...current, entries: current.entries.map((item) => item.id === entry.id ? { ...item, value: e.target.value } : item) }))} rows={3} placeholder="Entry value" className="w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-amber-100 focus:outline-none" />
                        </div>
                      ))}
                      <button onClick={() => upsertInfoboxSection(section.id, (current) => ({ ...current, entries: [...current.entries, { id: createId(), label: 'New label', value: 'New value' }] }))} className="rounded-lg border border-amber-700/30 px-3 py-2 text-xs text-amber-300 hover:bg-amber-900/20 cursor-pointer">
                        Add entry
                      </button>
                    </div>
                  ))}

                  <button onClick={() => updateActivePage((page) => ({ ...page, infobox: { ...page.infobox, sections: [...page.infobox.sections, createDefaultInfoboxSection(page.metadata.system)] } }))} className="rounded-lg border border-amber-700/40 bg-amber-900/20 px-3 py-2 text-sm text-amber-200 hover:bg-amber-900/40 cursor-pointer">
                    Add infobox section
                  </button>
                </div>
              ) : (
                <p className="text-xs text-stone-500">Enable the infobox to add a wiki-style info card to this page.</p>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
};
