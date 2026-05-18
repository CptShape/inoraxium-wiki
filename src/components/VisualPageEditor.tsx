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
  Trash2,
} from 'lucide-react';
import MarkdownRenderer from './MarkdownRenderer';
import { GameSystemId } from '../types';
import { createZip, stringToBytes } from '../utils/zip';
import { parseMarkdownContent } from '../utils/markdownContent';
import { parseInfoboxMarkup } from './Infobox';
import YAML from 'yaml';
import { UserPageRegistry, UserPageRegistryEntry } from '../data/user-pages';
import inoraxiumUserPageRegistry from '../data/inoraxium/user-pages/registry.json';
import horaghfusUserPageRegistry from '../data/horaghfus/user-pages/registry.json';

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
  labelLinkTarget: string;
  labelLinkTargetPart: string;
  valueLinkTarget: string;
  valueLinkTargetPart: string;
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
  rows: TableRowDraft[];
}

interface TableRowDraft {
  id: string;
  section: 'thead' | 'tbody' | 'tfoot';
  cells: TableCellDraft[];
}

interface TableCellDraft {
  id: string;
  content: string;
  tag: 'th' | 'td';
  colSpan: string;
  rowSpan: string;
}

interface ImportedWorkspaceSummary {
  workspaceId: string;
  workspaceTitle: string;
  system: GameSystemId;
  pageCount: number;
  pages: UserPageRegistryEntry[];
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
  entries: [{
    id: createId(),
    label: 'Example label',
    value: 'Example value',
    labelLinkTarget: '',
    labelLinkTargetPart: '',
    valueLinkTarget: '',
    valueLinkTargetPart: '',
  }],
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
  body: `---
title: Untitled Page ${index}
id: untitled-page-${index}
system: ${system}
sidebarVisible: true
width: 0.78
---

Start writing here...
`,
  infobox: createDefaultInfoboxDraft(system),
  assets: [],
});

const createDefaultTableDraft = (): TableDraft => ({
  className: 'tableRow',
  rows: [
    {
      id: createId(),
      section: 'thead',
      cells: [
        { id: createId(), content: 'Column A', tag: 'th', colSpan: '1', rowSpan: '1' },
        { id: createId(), content: 'Column B', tag: 'th', colSpan: '1', rowSpan: '1' },
        { id: createId(), content: 'Column C', tag: 'th', colSpan: '1', rowSpan: '1' },
      ],
    },
    {
      id: createId(),
      section: 'tbody',
      cells: [
        { id: createId(), content: 'Value', tag: 'td', colSpan: '1', rowSpan: '1' },
        { id: createId(), content: 'Value', tag: 'td', colSpan: '1', rowSpan: '1' },
        { id: createId(), content: 'Value', tag: 'td', colSpan: '1', rowSpan: '1' },
      ],
    },
    {
      id: createId(),
      section: 'tbody',
      cells: [
        { id: createId(), content: 'Value', tag: 'td', colSpan: '1', rowSpan: '1' },
        { id: createId(), content: 'Value', tag: 'td', colSpan: '1', rowSpan: '1' },
      ],
    },
  ],
});

const buildChapterLinkMarkup = (content: string, chapterId: string, chapterPart?: string) => {
  const target = chapterId.trim();
  if (!target) {
    return content;
  }

  const part = chapterPart?.trim();
  return `<a href="#" data-go-chapter="${target}"${part ? ` data-go-chapter-part="${part}"` : ''}>${content || 'Linked text'}</a>`;
};

const buildTableHtml = (table: TableDraft) => {
  const sectionOrder: Array<'thead' | 'tbody' | 'tfoot'> = ['thead', 'tbody', 'tfoot'];
  const sections = sectionOrder
    .map((section) => {
      const rows = table.rows.filter((row) => row.section === section);
      if (rows.length === 0) {
        return '';
      }

      const rowMarkup = rows
        .map((row) => {
          const cellMarkup = row.cells
            .map((cell) => {
              const attrs = [
                Number(cell.colSpan) > 1 ? ` colspan="${Number(cell.colSpan)}"` : '',
                Number(cell.rowSpan) > 1 ? ` rowspan="${Number(cell.rowSpan)}"` : '',
              ].join('');
              return `<${cell.tag}${attrs}>${cell.content || (cell.tag === 'th' ? 'Heading' : '')}</${cell.tag}>`;
            })
            .join('');

          return `<tr>${cellMarkup}</tr>`;
        })
        .join('');

      return `<${section}>${rowMarkup}</${section}>`;
    })
    .filter(Boolean)
    .join('');

  return `<table class="${table.className}">${sections}</table>`;
};

const typedInoraxiumUserPageRegistry = inoraxiumUserPageRegistry as unknown as UserPageRegistry;
const typedHoraghfusUserPageRegistry = horaghfusUserPageRegistry as unknown as UserPageRegistry;

const markdownModules = (import.meta as any).glob(
  ['../data/**/*.md'],
  { query: '?raw', import: 'default' }
) as Record<string, () => Promise<string>>;

const assetModules = (import.meta as any).glob(
  ['../data/**/*.{png,jpg,jpeg,webp,avif,gif,svg}'],
  { import: 'default' }
) as Record<string, () => Promise<string>>;

const normalizeMarkdownPath = (value: string) => {
  const trimmed = value.trim();
  if (trimmed.startsWith('src/')) {
    return `../${trimmed.slice('src/'.length)}`;
  }
  if (trimmed.startsWith('../data/')) {
    return trimmed;
  }
  return trimmed;
};

const mapParsedInfoboxToDraft = (infobox: ReturnType<typeof parseInfoboxMarkup>, system: GameSystemId): InfoboxDraft => {
  if (!infobox) {
    return createDefaultInfoboxDraft(system);
  }

  const firstImage = Array.isArray(infobox.image)
    ? infobox.image[0]
    : infobox.image;
  const imagePath = typeof firstImage === 'string'
    ? firstImage
    : firstImage?.src || '';

  return {
    enabled: true,
    imagePath,
    imageAlt: infobox.imageAlt || '',
    titleBackgroundColor: infobox.titleBackgroundColor || (system === 'horaghfus' ? '#b81932' : '#0052c2'),
    titleTextColor: infobox.titleTextColor || '#ffffff',
    sections: infobox.sections.map((section) => ({
      id: createId(),
      title: section.title,
      color: section.color,
      titleColor: section.titleColor,
      entryBackgroundColor: section.entryBackgroundColor,
      labelColor: section.labelColor,
      valueColor: section.valueColor,
      defaultOpen: section.defaultOpen,
      entries: section.entries.map((entry) => ({
        id: createId(),
        label: entry.label,
        value: entry.value,
        labelLinkTarget: '',
        labelLinkTargetPart: '',
        valueLinkTarget: '',
        valueLinkTargetPart: '',
      })),
    })),
  };
};

const createEditorAssetFromImportedFile = async (
  modulePath: string,
  sourceUrl: string,
  exportPathOverride?: string
): Promise<EditorAsset> => {
  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`Failed to load asset preview: ${modulePath}`);
  }

  const blob = await response.blob();
  const fileName = modulePath.slice(modulePath.lastIndexOf('/') + 1);
  const file = new File([blob], fileName, { type: blob.type || 'application/octet-stream' });

  return {
    id: createId(),
    file,
    exportPath: exportPathOverride || `assets/${fileName}`,
    objectUrl: URL.createObjectURL(file),
  };
};

const splitInfoboxFromPageMarkdown = (markdown: string, system: GameSystemId) => {
  const infoboxMatch = markdown.match(/<infobox\b[\s\S]*?<\/infobox>/i);
  if (!infoboxMatch) {
    return {
      body: markdown.trim(),
      infobox: createDefaultInfoboxDraft(system),
    };
  }

  const parsedInfobox = parseInfoboxMarkup(infoboxMatch[0]);
  const body = markdown.replace(infoboxMatch[0], '').trim();

  return {
    body,
    infobox: mapParsedInfoboxToDraft(parsedInfobox, system),
  };
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
      const labelContent = entry.labelLinkTarget
        ? buildChapterLinkMarkup(entry.label || 'Label', entry.labelLinkTarget, entry.labelLinkTargetPart)
        : (entry.label || 'Label');
      const valueContent = entry.valueLinkTarget
        ? buildChapterLinkMarkup(entry.value || 'Value', entry.valueLinkTarget, entry.valueLinkTargetPart)
        : (entry.value || 'Value');

      lines.push('    <infobox-entry>');
      lines.push(`      <infobox-entry-label>${labelContent}</infobox-entry-label>`);
      lines.push(`      <infobox-entry-value>${valueContent}</infobox-entry-value>`);
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
  const trimmedBody = page.body.trim();
  if (trimmedBody.startsWith('---')) {
    return trimmedBody;
  }

  const infoboxMarkup = buildInfoboxMarkup(page.metadata, page.infobox);
  return [infoboxMarkup, trimmedBody].filter(Boolean).join('\n\n').trim();
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

const setDocumentFrontmatter = (documentText: string, patch: Record<string, unknown>) => {
  const parsed = parseMarkdownContent(documentText);
  const nextFrontmatter = {
    ...(parsed.frontmatter ?? {}),
    ...patch,
  };
  const yamlText = YAML.stringify(nextFrontmatter).trim();
  const body = parsed.body.trimStart();
  return `---\n${yamlText}\n---\n\n${body}`;
};

export const VisualPageEditor: React.FC<VisualPageEditorProps> = ({ currentSystem, onExit }) => {
  const [pages, setPages] = useState<EditorPageDraft[]>(() => [createDefaultPageDraft(currentSystem)]);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<'write' | 'split' | 'preview'>('split');
  const [workspaceTitle, setWorkspaceTitle] = useState('New Workspace');
  const [workspaceId, setWorkspaceId] = useState('new-workspace');
  const [workspaceIdTouched, setWorkspaceIdTouched] = useState(false);
  const [linkText, setLinkText] = useState('Read more');
  const [linkTarget, setLinkTarget] = useState('');
  const [linkTargetPart, setLinkTargetPart] = useState('');
  const [partId, setPartId] = useState('new-part');
  const [partLabel, setPartLabel] = useState('New Section');
  const [exportError, setExportError] = useState('');
  const [tableDraft, setTableDraft] = useState<TableDraft>(createDefaultTableDraft);
  const [loadedWorkspaceId, setLoadedWorkspaceId] = useState<string | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const importedWorkspaces = useMemo<ImportedWorkspaceSummary[]>(() => {
    const registry = currentSystem === 'horaghfus' ? typedHoraghfusUserPageRegistry : typedInoraxiumUserPageRegistry;
    const entries = registry.pages.filter((entry) => entry.system === currentSystem && !entry.isFolder);
    const byWorkspace = new Map<string, ImportedWorkspaceSummary>();

    entries.forEach((entry) => {
      const existing = byWorkspace.get(entry.workspaceId);
      if (existing) {
        existing.pages.push(entry);
        existing.pageCount += 1;
        return;
      }

      byWorkspace.set(entry.workspaceId, {
        workspaceId: entry.workspaceId,
        workspaceTitle: entry.workspaceTitle || entry.workspaceId,
        system: entry.system,
        pageCount: 1,
        pages: [entry],
      });
    });

    return Array.from(byWorkspace.values()).sort((left, right) =>
      left.workspaceTitle.localeCompare(right.workspaceTitle, undefined, { sensitivity: 'base' })
    );
  }, [currentSystem]);

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

  const pageIdsInWorkspace = useMemo(
    () => pages.map((page) => page.metadata.id.trim()).filter(Boolean).sort(),
    [pages]
  );

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

  const updateActiveBody = (nextBody: string) => {
    updateActivePage((page) => ({ ...page, body: nextBody }));
  };

  const insertIntoSource = (prefix: string, suffix = '', fallback = '') => {
    const textarea = textareaRef.current;
    if (!textarea || !activePage) {
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = activePage.body.slice(start, end) || fallback;
    const nextBody = `${activePage.body.slice(0, start)}${prefix}${selected}${suffix}${activePage.body.slice(end)}`;
    updateActiveBody(nextBody);

    requestAnimationFrame(() => {
      textarea.focus();
      const cursorStart = start + prefix.length;
      const cursorEnd = cursorStart + selected.length;
      textarea.setSelectionRange(cursorStart, cursorEnd);
    });
  };

  const appendSourceBlock = (block: string) => {
    if (!activePage) return;
    updateActiveBody(`${activePage.body.trimEnd()}\n\n${block}\n`);
  };

  const applyFrontmatterPatch = (patch: Record<string, unknown>) => {
    if (!activePage) return;
    updateActiveBody(setDocumentFrontmatter(activePage.body, patch));
  };

  const insertDataPartHeading = () => {
    appendSourceBlock(`<h2 data-part="${partId || 'new-part'}">${partLabel || 'New Section'}</h2>`);
  };

  const insertChapterLink = () => {
    insertIntoSource(
      `[[${linkTarget || 'target-id'}${linkTargetPart ? `#${linkTargetPart}` : ''}|`,
      ']]',
      linkText || 'Read more'
    );
  };

  const insertBuiltTable = () => {
    appendSourceBlock(buildTableHtml(tableDraft));
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

  const updateTableRow = (rowId: string, updater: (row: TableRowDraft) => TableRowDraft) => {
    setTableDraft((prev) => ({
      ...prev,
      rows: prev.rows.map((row) => (row.id === rowId ? updater(row) : row)),
    }));
  };

  const addTableRow = (section: 'thead' | 'tbody' | 'tfoot' = 'tbody') => {
    setTableDraft((prev) => ({
      ...prev,
      rows: [
        ...prev.rows,
        {
          id: createId(),
          section,
          cells: [
            {
              id: createId(),
              content: section === 'thead' ? 'Heading' : 'Value',
              tag: section === 'thead' ? 'th' : 'td',
              colSpan: '1',
              rowSpan: '1',
            },
          ],
        },
      ],
    }));
  };

  const removeTableRow = (rowId: string) => {
    setTableDraft((prev) => ({
      ...prev,
      rows: prev.rows.length <= 1 ? prev.rows : prev.rows.filter((row) => row.id !== rowId),
    }));
  };

  const addCellToRow = (rowId: string) => {
    updateTableRow(rowId, (row) => ({
      ...row,
      cells: [
        ...row.cells,
        {
          id: createId(),
          content: row.section === 'thead' ? 'Heading' : 'Value',
          tag: row.section === 'thead' ? 'th' : 'td',
          colSpan: '1',
          rowSpan: '1',
        },
      ],
    }));
  };

  const removeCellFromRow = (rowId: string, cellId: string) => {
    updateTableRow(rowId, (row) => ({
      ...row,
      cells: row.cells.length <= 1 ? row.cells : row.cells.filter((cell) => cell.id !== cellId),
    }));
  };

  const updateTableCell = (
    rowId: string,
    cellId: string,
    updater: (cell: TableCellDraft) => TableCellDraft
  ) => {
    updateTableRow(rowId, (row) => ({
      ...row,
      cells: row.cells.map((cell) => (cell.id === cellId ? updater(cell) : cell)),
    }));
  };

  const loadImportedWorkspace = async (workspace: ImportedWorkspaceSummary) => {
    setWorkspaceLoading(true);
    setExportError('');

    try {
      const loadedPages = await Promise.all(
        workspace.pages.map(async (entry) => {
          const pagePath = normalizeMarkdownPath(entry.content);
          const loader = markdownModules[pagePath];

          if (!loader) {
            throw new Error(`Could not resolve markdown file: ${entry.content}`);
          }

          const pageMarkdown = await loader();
          const { body, infobox } = splitInfoboxFromPageMarkdown(pageMarkdown, entry.system);
          const pageDirectory = pagePath.slice(0, pagePath.lastIndexOf('/'));
          const workspaceDirectory = pageDirectory.slice(0, pageDirectory.lastIndexOf('/'));
          const assetPrefixes = [`${pageDirectory}/assets/`, `${workspaceDirectory}/assets/`];
          const assetLoaders = Object.entries(assetModules).filter(([assetPath]) =>
            assetPrefixes.some((prefix) => assetPath.startsWith(prefix))
          );
          const assets = await Promise.all(
            assetLoaders.map(async ([assetPath, assetLoader]) => {
              const sourceUrl = await assetLoader();
              const exportPath = assetPrefixes.find((prefix) => assetPath.startsWith(prefix))
                ? `assets/${assetPath.replace(assetPrefixes.find((prefix) => assetPath.startsWith(prefix))!, '')}`
                : undefined;
              return createEditorAssetFromImportedFile(assetPath, sourceUrl, exportPath?.replace(/\\/g, '/'));
            })
          );

          return {
            pageId: createId(),
            metadata: {
              id: entry.id,
              title: entry.title,
              subtitle: entry.subtitle || '',
              icon: entry.icon || '',
              system: entry.system,
              parentId: entry.parentId || '',
              sidebarVisible: entry.sidebarVisible,
              order: entry.order || '',
              width: String(entry.width ?? '0.78'),
            },
            body: body || '<p>Start writing here...</p>',
            infobox,
            assets,
          } satisfies EditorPageDraft;
        })
      );

      const sortedPages = [...loadedPages].sort((left, right) =>
        (left.metadata.order || '').localeCompare(right.metadata.order || '', undefined, { numeric: true, sensitivity: 'base' })
      );

      setPages(sortedPages.length > 0 ? sortedPages : [createDefaultPageDraft(currentSystem)]);
      setActivePageId(sortedPages[0]?.pageId ?? null);
      setLoadedWorkspaceId(workspace.workspaceId);
      setWorkspaceTitle(workspace.workspaceTitle);
      setWorkspaceId(workspace.workspaceId);
      setWorkspaceIdTouched(true);
      setEditorMode('split');
    } catch (error) {
      console.error(error);
      setExportError(error instanceof Error ? error.message : 'Failed to load imported workspace.');
    } finally {
      setWorkspaceLoading(false);
    }
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
        workspaceTitle: workspaceTitle.trim() || 'Untitled Workspace',
        workspaceId: slugify(workspaceId) || slugify(workspaceTitle) || 'user-workspace',
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

      const workspaceSlug = slugify(workspaceId) || slugify(workspaceTitle) || slugify(normalizedPages[0]?.metadata.title || 'page-workspace') || 'page-workspace';
      const root = `${workspaceSlug}-export`;
      const zipEntries = [
        { name: `${root}/manifest.json`, data: stringToBytes(JSON.stringify(manifest, null, 2)) },
        { name: `${root}/publish-info.txt`, data: stringToBytes(buildPublishInfo(normalizedPages)) },
      ];

      for (const page of normalizedPages) {
        const compiled = buildCompiledMarkdown(page);
        const parsed = parseMarkdownContent(compiled);
        zipEntries.push({ name: `${root}/pages/${page.metadata.id}/page.md`, data: stringToBytes(compiled) });
        zipEntries.push({ name: `${root}/pages/${page.metadata.id}/body.md`, data: stringToBytes(parsed.body) });

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

  const handleWorkspaceTitleChange = (value: string) => {
    setWorkspaceTitle(value);
    if (!workspaceIdTouched) {
      setWorkspaceId(slugify(value) || 'new-workspace');
    }
  };

  const handleWorkspaceIdChange = (value: string) => {
    setWorkspaceIdTouched(true);
    setWorkspaceId(slugify(value) || value);
  };

  const syncWorkspaceIdToTitle = () => {
    setWorkspaceIdTouched(true);
    setWorkspaceId(slugify(workspaceTitle) || 'new-workspace');
  };

  return (
    <div className="flex-1 overflow-y-auto bg-stone-800/30">
      <div className="mx-auto max-w-[2200px] px-5 py-6 2xl:px-8">
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
            <p className="text-sm text-amber-600">Write plain markdown with frontmatter, wiki links, and inline assets, then preview it live.</p>
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

        <div className="grid gap-5 xl:grid-cols-[17rem_minmax(0,1.4fr)_24rem] 2xl:grid-cols-[18rem_minmax(0,1.7fr)_26rem]">
          <aside className="rounded-2xl border border-amber-800/30 bg-stone-900/50 p-4">
            <div className="mb-4 rounded-xl border border-amber-800/20 bg-black/15 p-3">
              <p className="text-xs uppercase tracking-[0.2em] text-amber-600" style={{ fontFamily: "'Cinzel', serif" }}>
                Imported Workspaces
              </p>
              <p className="mt-1 text-[11px] text-amber-300/70">
                Load previously imported user-page sets back into the editor.
              </p>
              <div className="mt-3 space-y-2">
                {importedWorkspaces.length === 0 ? (
                  <p className="text-xs text-stone-500">No imported workspaces for {currentSystem} yet.</p>
                ) : (
                  importedWorkspaces.map((workspace) => {
                    const isLoaded = loadedWorkspaceId === workspace.workspaceId;
                    return (
                      <button
                        key={workspace.workspaceId}
                        onClick={() => void loadImportedWorkspace(workspace)}
                        disabled={workspaceLoading}
                        className={`w-full rounded-lg border px-3 py-2 text-left transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-wait ${
                          isLoaded
                            ? 'border-amber-500/50 bg-amber-900/25'
                            : 'border-stone-800/70 bg-stone-950/40 hover:border-stone-700 hover:bg-amber-950/10'
                        }`}
                      >
                        <div className="truncate text-sm font-bold text-amber-200" style={{ fontFamily: "'Cinzel', serif" }}>
                          {workspace.workspaceTitle}
                        </div>
                        <div className="text-[11px] text-amber-600">
                          {workspace.pageCount} page(s)
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

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
                    {(['write', 'split', 'preview'] as const).map((mode) => (
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
                  <button onClick={() => insertIntoSource('**', '**', 'bold text')} className="rounded border border-amber-800/30 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-900/20 cursor-pointer"><Bold size={12} className="inline mr-1" />Bold</button>
                  <button onClick={() => insertIntoSource('*', '*', 'italic text')} className="rounded border border-amber-800/30 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-900/20 cursor-pointer"><Italic size={12} className="inline mr-1" />Italic</button>
                  <button onClick={() => appendSourceBlock('## New Heading')} className="rounded border border-amber-800/30 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-900/20 cursor-pointer"><Heading2 size={12} className="inline mr-1" />Heading</button>
                  <button onClick={() => appendSourceBlock('### New Subheading')} className="rounded border border-amber-800/30 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-900/20 cursor-pointer"><Heading3 size={12} className="inline mr-1" />Subheading</button>
                  <button onClick={() => appendSourceBlock('- First item\n- Second item')} className="rounded border border-amber-800/30 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-900/20 cursor-pointer"><List size={12} className="inline mr-1" />Bullets</button>
                  <button onClick={() => appendSourceBlock('1. First item\n2. Second item')} className="rounded border border-amber-800/30 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-900/20 cursor-pointer"><ListOrdered size={12} className="inline mr-1" />Numbers</button>
                  <button onClick={() => appendSourceBlock('> Lore callout text')} className="rounded border border-amber-800/30 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-900/20 cursor-pointer">Callout</button>
                  <button onClick={insertChapterLink} className="rounded border border-amber-800/30 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-900/20 cursor-pointer"><Link2 size={12} className="inline mr-1" />Link</button>
                  <button onClick={insertDataPartHeading} className="rounded border border-amber-800/30 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-900/20 cursor-pointer">data-part</button>
                  <button
                    onClick={() => activePage.assets[0] && appendSourceBlock(`![[${activePage.assets[0].exportPath}]]`)}
                    disabled={activePage.assets.length === 0}
                    className="rounded border border-amber-800/30 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-900/20 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <ImagePlus size={12} className="inline mr-1" />Image
                  </button>
                </div>
              </div>

              {editorMode === 'write' && (
                <textarea
                  value={activePage.body}
                  ref={textareaRef}
                  onChange={(e) => updateActiveBody(e.target.value)}
                  className="min-h-[78vh] w-full resize-none bg-stone-950 px-5 py-5 text-amber-100 focus:outline-none font-mono"
                />
              )}

              {editorMode === 'split' && (
                <div className="grid min-h-[78vh] gap-0 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
                  <textarea
                    value={activePage.body}
                    ref={textareaRef}
                    onChange={(e) => updateActiveBody(e.target.value)}
                    className="min-h-[78vh] w-full resize-none border-r border-amber-800/20 bg-stone-950 px-5 py-5 text-amber-100 focus:outline-none font-mono"
                  />
                  <div className="editor-canvas-shell leather-bg min-h-[78vh] p-6">
                    <div className="mx-auto" style={{ width: `${Math.max(0.45, Math.min(1, Number(activePage.metadata.width) || 0.78)) * 100}%`, minWidth: '680px' }}>
                      <div className="min-h-[70vh] rounded-[1.75rem] border border-amber-900/20 bg-stone-900/70 px-8 py-8">
                        <MarkdownRenderer path={activePage.body || '_No content yet._'} assetMap={assetMap} />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {editorMode === 'preview' && (
                <div className="editor-canvas-shell leather-bg min-h-[78vh] p-6">
                  <div className="mx-auto" style={{ width: `${Math.max(0.45, Math.min(1, Number(activePage.metadata.width) || 0.78)) * 100}%`, minWidth: '680px' }}>
                    <div className="min-h-[70vh] rounded-[1.75rem] border border-amber-900/20 bg-stone-900/70 px-8 py-8">
                      <MarkdownRenderer path={activePage.body || '_No content yet._'} assetMap={assetMap} />
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
                Workspace
              </h3>
              <div className="space-y-3">
                <input
                  value={workspaceTitle}
                  onChange={(e) => handleWorkspaceTitleChange(e.target.value)}
                  placeholder="Workspace name"
                  className="w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-amber-100 focus:outline-none"
                />
                <div className="flex gap-2">
                  <input
                    value={workspaceId}
                    onChange={(e) => handleWorkspaceIdChange(e.target.value)}
                    placeholder="workspace-id"
                    className="w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-amber-100 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={syncWorkspaceIdToTitle}
                    className="shrink-0 rounded-lg border border-amber-800/30 px-3 py-2 text-xs text-amber-300 hover:bg-amber-900/20 cursor-pointer"
                  >
                    Match name
                  </button>
                </div>
                <p className="text-xs text-stone-500">
                  Keep the same workspace id when updating an existing imported workspace.
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-amber-800/30 bg-stone-900/50 p-4">
              <h3 className="mb-3 text-sm font-bold uppercase tracking-[0.2em] text-amber-500" style={{ fontFamily: "'Cinzel', serif" }}>
                Syntax Snippets
              </h3>
              <div className="space-y-2">
                <button onClick={() => applyFrontmatterPatch({
                  title: activePage.metadata.title || 'Untitled Page',
                  id: activePage.metadata.id || slugify(activePage.metadata.title) || 'page-id',
                  system: currentSystem,
                  sidebarVisible: true,
                  width: 0.78,
                  image: 'assets/example.png',
                  infobox: 'Overview',
                  population: 12000,
                  layout: [
                    { type: 'header', text: 'Demographics', above: 'population' },
                  ],
                })} className="w-full rounded-lg border border-amber-800/30 px-3 py-2 text-left text-xs text-amber-300 hover:bg-amber-900/20 cursor-pointer">
                  Insert frontmatter template
                </button>
                <button onClick={() => applyFrontmatterPatch({
                  title: activePage.metadata.title || 'Untitled Page',
                  infobox: 'Overview',
                  birthplace: 'Example City',
                  allegiance: 'Example Faction',
                  layout: [
                    { type: 'header', text: 'Biographical Information', above: 'birthplace' },
                    { type: 'header', text: 'Affiliations', above: 'allegiance' },
                  ],
                })} className="w-full rounded-lg border border-amber-800/30 px-3 py-2 text-left text-xs text-amber-300 hover:bg-amber-900/20 cursor-pointer">
                  Insert infobox layout example
                </button>
                <button onClick={() => appendSourceBlock(`[[bard|Bard]]\n[[bard#glamour|Bard Glamour]]\n![[assets/example.png]]`)} className="w-full rounded-lg border border-amber-800/30 px-3 py-2 text-left text-xs text-amber-300 hover:bg-amber-900/20 cursor-pointer">
                  Insert link + image examples
                </button>
                <button onClick={() => appendSourceBlock(`<div class="gallery small">\n  <figure>\n    ![[assets/example.png]]\n    <figcaption>Caption</figcaption>\n  </figure>\n</div>`)} className="w-full rounded-lg border border-amber-800/30 px-3 py-2 text-left text-xs text-amber-300 hover:bg-amber-900/20 cursor-pointer">
                  Insert gallery example
                </button>
              </div>
              <p className="mt-3 text-xs text-stone-500">
                These are starter text commands, closer to Chronicler’s writing model. The preview interprets them live.
              </p>
            </div>

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
                  <button onClick={() => addTableRow('thead')} className="rounded border border-amber-800/30 px-2 py-1 text-xs text-amber-300 hover:bg-amber-900/20 cursor-pointer">Add head row</button>
                  <button onClick={() => addTableRow('tbody')} className="rounded border border-amber-800/30 px-2 py-1 text-xs text-amber-300 hover:bg-amber-900/20 cursor-pointer">Add body row</button>
                  <button onClick={() => addTableRow('tfoot')} className="rounded border border-amber-800/30 px-2 py-1 text-xs text-amber-300 hover:bg-amber-900/20 cursor-pointer">Add foot row</button>
                </div>

                <div className="space-y-3">
                  {tableDraft.rows.map((row, rowIndex) => (
                    <div key={row.id} className="rounded-xl border border-stone-800 bg-black/20 p-3 space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-bold uppercase tracking-[0.18em] text-amber-600" style={{ fontFamily: "'Cinzel', serif" }}>
                          Row {rowIndex + 1}
                        </span>
                        <select
                          value={row.section}
                          onChange={(e) =>
                            updateTableRow(row.id, (current) => ({
                              ...current,
                              section: e.target.value as 'thead' | 'tbody' | 'tfoot',
                              cells: current.cells.map((cell) => ({
                                ...cell,
                                tag: e.target.value === 'thead' ? 'th' : cell.tag,
                              })),
                            }))
                          }
                          className="rounded border border-stone-700 bg-stone-900 px-2 py-1 text-xs text-amber-100 focus:outline-none"
                        >
                          <option value="thead">thead</option>
                          <option value="tbody">tbody</option>
                          <option value="tfoot">tfoot</option>
                        </select>
                        <button onClick={() => addCellToRow(row.id)} className="rounded border border-amber-800/30 px-2 py-1 text-xs text-amber-300 hover:bg-amber-900/20 cursor-pointer">Add cell</button>
                        <button onClick={() => removeTableRow(row.id)} className="rounded border border-red-800/30 px-2 py-1 text-xs text-red-300 hover:bg-red-950/20 cursor-pointer">Delete row</button>
                      </div>

                      <div className="space-y-2">
                        {row.cells.map((cell, cellIndex) => (
                          <div key={cell.id} className="rounded-lg border border-stone-800 bg-stone-950/50 p-3 space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-[11px] uppercase tracking-[0.16em] text-stone-500">Cell {cellIndex + 1}</span>
                              <select
                                value={cell.tag}
                                onChange={(e) => updateTableCell(row.id, cell.id, (current) => ({ ...current, tag: e.target.value as 'th' | 'td' }))}
                                className="rounded border border-stone-700 bg-stone-900 px-2 py-1 text-xs text-amber-100 focus:outline-none"
                              >
                                <option value="th">th</option>
                                <option value="td">td</option>
                              </select>
                              <input
                                value={cell.colSpan}
                                onChange={(e) => updateTableCell(row.id, cell.id, (current) => ({ ...current, colSpan: e.target.value }))}
                                placeholder="colspan"
                                className="w-20 rounded border border-stone-700 bg-stone-900 px-2 py-1 text-xs text-amber-100 focus:outline-none"
                              />
                              <input
                                value={cell.rowSpan}
                                onChange={(e) => updateTableCell(row.id, cell.id, (current) => ({ ...current, rowSpan: e.target.value }))}
                                placeholder="rowspan"
                                className="w-20 rounded border border-stone-700 bg-stone-900 px-2 py-1 text-xs text-amber-100 focus:outline-none"
                              />
                              <button onClick={() => removeCellFromRow(row.id, cell.id)} className="rounded border border-red-800/30 px-2 py-1 text-xs text-red-300 hover:bg-red-950/20 cursor-pointer">Delete cell</button>
                            </div>
                            <textarea
                              value={cell.content}
                              onChange={(e) => updateTableCell(row.id, cell.id, (current) => ({ ...current, content: e.target.value }))}
                              rows={2}
                              placeholder="Cell content"
                              className="w-full rounded border border-stone-700 bg-stone-900 px-3 py-2 text-xs text-amber-100 focus:outline-none"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <p className="text-xs text-stone-500">
                  Each row can live in `thead`, `tbody`, or `tfoot`, and each cell can be `th` or `td` with its own colspan and rowspan.
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
                      <button onClick={() => appendSourceBlock(`![[${asset.exportPath}]]`)} className="rounded border border-amber-800/30 px-2 py-1 text-[11px] text-amber-300 hover:bg-amber-900/20 cursor-pointer">Insert</button>
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
                          <div className="grid grid-cols-2 gap-2">
                            <input value={entry.labelLinkTarget} onChange={(e) => upsertInfoboxSection(section.id, (current) => ({ ...current, entries: current.entries.map((item) => item.id === entry.id ? { ...item, labelLinkTarget: e.target.value } : item) }))} placeholder="Label link target" className="w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-xs text-amber-100 focus:outline-none" />
                            <input value={entry.labelLinkTargetPart} onChange={(e) => upsertInfoboxSection(section.id, (current) => ({ ...current, entries: current.entries.map((item) => item.id === entry.id ? { ...item, labelLinkTargetPart: e.target.value } : item) }))} placeholder="Label link part" className="w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-xs text-amber-100 focus:outline-none" />
                          </div>
                          <textarea value={entry.value} onChange={(e) => upsertInfoboxSection(section.id, (current) => ({ ...current, entries: current.entries.map((item) => item.id === entry.id ? { ...item, value: e.target.value } : item) }))} rows={3} placeholder="Entry value" className="w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-amber-100 focus:outline-none" />
                          <div className="grid grid-cols-2 gap-2">
                            <input value={entry.valueLinkTarget} onChange={(e) => upsertInfoboxSection(section.id, (current) => ({ ...current, entries: current.entries.map((item) => item.id === entry.id ? { ...item, valueLinkTarget: e.target.value } : item) }))} placeholder="Value link target" className="w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-xs text-amber-100 focus:outline-none" />
                            <input value={entry.valueLinkTargetPart} onChange={(e) => upsertInfoboxSection(section.id, (current) => ({ ...current, entries: current.entries.map((item) => item.id === entry.id ? { ...item, valueLinkTargetPart: e.target.value } : item) }))} placeholder="Value link part" className="w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-xs text-amber-100 focus:outline-none" />
                          </div>
                          <p className="text-[11px] text-stone-500">
                            Fill the link target fields to make the label or value clickable in the exported infobox.
                          </p>
                        </div>
                      ))}
                      <button onClick={() => upsertInfoboxSection(section.id, (current) => ({ ...current, entries: [...current.entries, { id: createId(), label: 'New label', value: 'New value', labelLinkTarget: '', labelLinkTargetPart: '', valueLinkTarget: '', valueLinkTargetPart: '' }] }))} className="rounded-lg border border-amber-700/30 px-3 py-2 text-xs text-amber-300 hover:bg-amber-900/20 cursor-pointer">
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
