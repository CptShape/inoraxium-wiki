import React, { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { ChevronDown, ChevronUp } from 'lucide-react';

export interface InfoboxEntryData {
  label: string;
  value: string;
}

export interface InfoboxSectionData {
  title: string;
  color: string;
  titleColor: string;
  entryBackgroundColor: string;
  labelColor: string;
  valueColor: string;
  defaultOpen: boolean;
  entries: InfoboxEntryData[];
}

export interface InfoboxData {
  title: string;
  image?: string;
  imageAlt?: string;
  titleBackgroundColor?: string;
  titleTextColor?: string;
  sections: InfoboxSectionData[];
}

interface InfoboxProps {
  data: InfoboxData;
  renderRichText: (content: string, className?: string) => React.ReactNode;
  assetMap?: Record<string, string>;
}

const imageModules = (import.meta as any).glob(
  ['../**/*.{png,jpg,jpeg,webp,avif,gif,svg}'],
  { eager: true, import: 'default' }
) as Record<string, string>;

const normalizeAssetPath = (value?: string) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^(https?:)?\/\//.test(trimmed) || trimmed.startsWith('/')) {
    return trimmed;
  }
  if (trimmed.startsWith('src/')) {
    return `../${trimmed.slice('src/'.length)}`;
  }
  return trimmed;
};

const resolveImagePath = (value?: string, assetMap?: Record<string, string>) => {
  const normalized = normalizeAssetPath(value);
  if (!normalized) return null;
  if (assetMap?.[normalized]) return assetMap[normalized];
  if (assetMap?.[value ?? '']) return assetMap[value ?? ''];
  return imageModules[normalized] ?? normalized;
};

const toRgba = (value: string, alpha: number) => {
  const hex = value.trim().replace('#', '');
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    const r = parseInt(hex[0] + hex[0], 16);
    const g = parseInt(hex[1] + hex[1], 16);
    const b = parseInt(hex[2] + hex[2], 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return value;
};

export const parseInfoboxMarkup = (markup: string): InfoboxData | null => {
  if (typeof window === 'undefined') return null;

  const parser = new DOMParser();
  const doc = parser.parseFromString(markup, 'text/html');
  const root = doc.body.firstElementChild;

  if (!root || root.tagName.toLowerCase() !== 'infobox') {
    return null;
  }

  const titleFromAttr = root.getAttribute('title')?.trim();
  const titleNode = root.querySelector(':scope > infobox-title');
  const title = titleNode?.innerHTML.trim() || titleFromAttr || 'Infobox';

  const sections = Array.from(root.querySelectorAll(':scope > infobox-section')).map((sectionNode) => {
    const titleAttr = sectionNode.getAttribute('title')?.trim();
    const titleChild = sectionNode.querySelector(':scope > infobox-section-title');
    const sectionTitle = titleChild?.innerHTML.trim() || titleAttr || 'Section';
    const color = sectionNode.getAttribute('color')?.trim() || '#b91c1c';
    const titleColor = sectionNode.getAttribute('title-color')?.trim() || '#ffffff';
    const entryBackgroundColor = sectionNode.getAttribute('entry-background-color')?.trim() || '#ffffff';
    const labelColor = sectionNode.getAttribute('label-color')?.trim() || '#000000';
    const valueColor = sectionNode.getAttribute('value-color')?.trim() || '#000000';
    const defaultOpenAttr = sectionNode.getAttribute('default-open');
    const defaultOpen = defaultOpenAttr !== 'false';

    const entries = Array.from(sectionNode.querySelectorAll(':scope > infobox-entry')).map((entryNode) => {
      const labelAttr = entryNode.getAttribute('label')?.trim();
      const valueAttr = entryNode.getAttribute('value')?.trim();
      const labelChild = entryNode.querySelector(':scope > infobox-entry-label');
      const valueChild = entryNode.querySelector(':scope > infobox-entry-value');

      return {
        label: labelChild?.innerHTML.trim() || labelAttr || '',
        value: valueChild?.innerHTML.trim() || valueAttr || '',
      };
    });

    return {
      title: sectionTitle,
      color,
      titleColor,
      entryBackgroundColor,
      labelColor,
      valueColor,
      defaultOpen,
      entries,
    };
  });

  return {
    title,
    image: root.getAttribute('image')?.trim() || undefined,
    imageAlt: root.getAttribute('image-alt')?.trim() || undefined,
    titleBackgroundColor: root.getAttribute('title-background-color')?.trim() || undefined,
    titleTextColor: root.getAttribute('title-text-color')?.trim() || undefined,
    sections,
  };
};

const Infobox: React.FC<InfoboxProps> = ({ data, renderRichText, assetMap }) => {
  const [openSections, setOpenSections] = useState<Record<number, boolean>>(() =>
    Object.fromEntries(data.sections.map((section, index) => [index, section.defaultOpen]))
  );

  useEffect(() => {
    setOpenSections(
      Object.fromEntries(data.sections.map((section, index) => [index, section.defaultOpen]))
    );
  }, [data]);

  const resolvedImage = useMemo(() => resolveImagePath(data.image, assetMap), [assetMap, data.image]);
  const titleBackgroundColor = data.titleBackgroundColor || 'rgb(var(--theme-700-rgb) / 0.92)';
  const titleTextColor = data.titleTextColor || '#ffffff';

  return (
    <aside className="w-full md:float-right md:clear-right md:ml-6 mb-6 md:max-w-[21rem] rounded-2xl overflow-hidden border border-amber-800/40 bg-stone-950/90 shadow-2xl shadow-black/35">
      {resolvedImage && (
        <div className="border-b border-amber-900/30 bg-black/30">
          <img
            src={resolvedImage}
            alt={data.imageAlt || data.title}
            className="block h-auto w-full object-cover"
          />
        </div>
      )}

      <div
        className="border-b border-amber-900/30 px-4 py-3 text-center"
        style={{ backgroundColor: titleBackgroundColor }}
      >
        <div className="text-xl font-bold" style={{ fontFamily: "'Cinzel', serif", color: titleTextColor }}>
          {renderRichText(data.title, 'text-inherit [&_p]:mb-0 [&_a]:text-inherit [&_a]:underline [&_a:hover]:text-slate-100')}
        </div>
      </div>

      <div className="bg-stone-100 text-stone-900">
        {data.sections.map((section, sectionIndex) => {
          const isOpen = openSections[sectionIndex] ?? section.defaultOpen;
          const sectionBorder = toRgba(section.color, 0.35);
          const sectionBackground = section.color;

          return (
            <section
              key={`${section.title}-${sectionIndex}`}
              className="border-b last:border-b-0"
              style={{ borderColor: sectionBorder }}
            >
              <button
                type="button"
                onClick={() =>
                  setOpenSections((prev) => ({
                    ...prev,
                    [sectionIndex]: !isOpen,
                  }))
                }
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
                style={{ backgroundColor: sectionBackground, color: section.titleColor }}
              >
                <span className="text-sm font-bold uppercase tracking-[0.08em]" style={{ fontFamily: "'Cinzel', serif" }}>
                  {renderRichText(section.title, 'text-inherit [&_p]:mb-0 [&_a]:text-inherit [&_a]:underline [&_a:hover]:text-slate-100')}
                </span>
                {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>

              {isOpen && (
                <div className="divide-y divide-stone-200">
                  {section.entries.map((entry, entryIndex) => (
                    <div
                      key={`${sectionIndex}-${entryIndex}`}
                      className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-start gap-3 px-3 py-2 text-sm"
                      style={{ backgroundColor: section.entryBackgroundColor }}
                    >
                      <div className="font-semibold" style={{ fontFamily: "'Cinzel', serif", color: section.labelColor }}>
                        {renderRichText(
                          entry.label,
                          'text-inherit [&_p]:mb-0 [&_a]:text-blue-700 [&_a]:underline [&_a:hover]:text-blue-500'
                        )}
                      </div>
                      <div className="min-w-0" style={{ color: section.valueColor }}>
                        {renderRichText(
                          entry.value,
                          'text-inherit [&_p]:mb-0 [&_a]:text-blue-700 [&_a]:underline [&_a:hover]:text-blue-500 [&_ul]:mb-0 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:mb-0 [&_ol]:list-decimal [&_ol]:pl-4'
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </aside>
  );
};

export const renderInfoboxRichText = (
  content: string,
  components: Record<string, React.ElementType>,
  className?: string
) => {
  const wrapped = className ? `<div class="${className}">${content}</div>` : content;

  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={components}>
      {wrapped}
    </ReactMarkdown>
  );
};

export default Infobox;
