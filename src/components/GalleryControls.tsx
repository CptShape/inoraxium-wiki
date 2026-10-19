import React, { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import {
  activeQueryToken,
  completeQueryToken,
  GalleryTag,
  GALLERY_CATEGORIES,
  GALLERY_CATEGORY_LABELS,
  normalizeTag,
} from "../lib/gallery";
import { CharacterGalleryTagCategory } from "../types/character";

export function GallerySearch({
  value,
  onChange,
  tags,
  label = "Search gallery tags",
  placeholder = "ayrton splash_art -nsfw",
  onPick,
}: {
  value: string;
  onChange: (value: string) => void;
  tags: GalleryTag[];
  label?: string;
  placeholder?: string;
  onPick?: (tag: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [caret, setCaret] = useState(value.length);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(0);
  const id = useId();
  const token = activeQueryToken(value, caret);
  const fragment = normalizeTag(token.text);
  const suggestions = tags
    .filter((tag) => !fragment || tag.name.includes(fragment))
    .sort(
      (a, b) =>
        Number(b.name.startsWith(fragment)) -
          Number(a.name.startsWith(fragment)) || a.name.localeCompare(b.name),
    )
    .slice(0, 10);
  const expanded = open && suggestions.length > 0;
  const pick = (tag: string) => {
    if (onPick) {
      onPick(tag);
      onChange("");
      setCaret(0);
    } else {
      const next = completeQueryToken(value, caret, tag);
      onChange(next.value);
      setCaret(next.caret);
      requestAnimationFrame(() =>
        input.current?.setSelectionRange(next.caret, next.caret),
      );
    }
    setOpen(false);
    input.current?.focus();
  };
  return (
    <div className="gallery-autocomplete">
      <label className="gallery-sr-only" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        ref={input}
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={`${id}-options`}
        aria-activedescendant={
          expanded
            ? `${id}-${Math.min(selected, suggestions.length - 1)}`
            : undefined
        }
        value={value}
        placeholder={placeholder}
        onChange={(event) => {
          onChange(event.target.value);
          setCaret(event.target.selectionStart ?? event.target.value.length);
          setSelected(0);
          setOpen(true);
        }}
        onSelect={(event) => {
          setCaret(event.currentTarget.selectionStart ?? value.length);
          setSelected(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.stopPropagation();
            setOpen(false);
          }
          if (expanded && ["ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            setSelected(
              (index) =>
                (index +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  suggestions.length) %
                suggestions.length,
            );
          }
          if (expanded && (event.key === "Enter" || event.key === "Tab")) {
            event.preventDefault();
            pick(suggestions[Math.min(selected, suggestions.length - 1)].name);
          } else if (event.key === "Enter" && onPick && fragment) {
            event.preventDefault();
            pick(fragment);
          }
        }}
      />
      {expanded && (
        <div
          className="gallery-suggestions"
          role="listbox"
          id={`${id}-options`}
          aria-label="Suggested tags"
        >
          {suggestions.map((tag, index) => (
            <button
              type="button"
              role="option"
              aria-selected={index === selected}
              id={`${id}-${index}`}
              key={tag.name}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(tag.name)}
            >
              <span>
                {token.text.startsWith("-") && !onPick ? "− " : ""}
                {tag.name}
              </span>
              <small data-category={tag.category}>
                {GALLERY_CATEGORY_LABELS[tag.category]}
              </small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function GalleryTagPicker({
  selected,
  onChange,
  tags,
  onCreate,
  label = "Image tags",
  categories = GALLERY_CATEGORIES,
}: {
  selected: string[];
  onChange: (tags: string[]) => void;
  tags: GalleryTag[];
  onCreate: (tag: GalleryTag) => void;
  label?: string;
  categories?: CharacterGalleryTagCategory[];
}) {
  const [draft, setDraft] = useState("");
  const [category, setCategory] = useState<CharacterGalleryTagCategory>(
    categories.includes("general") ? "general" : categories[0],
  );
  const add = (raw: string) => {
    const name = normalizeTag(raw);
    if (!name) return;
    if (!tags.some((tag) => tag.name === name)) onCreate({ name, category });
    onChange([...new Set([...selected, name])]);
    setDraft("");
  };
  return (
    <div className="gallery-tag-picker">
      <span className="gallery-field-label">{label}</span>
      <div className="gallery-tag-chips">
        {selected.map((tag) => (
          <button
            type="button"
            key={tag}
            onClick={() => onChange(selected.filter((name) => name !== tag))}
            aria-label={`Remove tag ${tag}`}
          >
            {tag}
            <X size={12} />
          </button>
        ))}
      </div>
      <div className="gallery-tag-create">
        <GallerySearch
          label={`${label}: select or create tag`}
          placeholder="Find or create a tag…"
          tags={tags.filter((tag) => !selected.includes(tag.name))}
          value={draft}
          onChange={setDraft}
          onPick={add}
        />
        <select
          aria-label={`${label}: new tag category`}
          value={category}
          onChange={(event) =>
            setCategory(event.target.value as CharacterGalleryTagCategory)
          }
        >
          {categories.map((value) => (
            <option key={value} value={value}>
              {GALLERY_CATEGORY_LABELS[value]}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!normalizeTag(draft)}
          onClick={() => add(draft)}
        >
          Add tag
        </button>
      </div>
    </div>
  );
}

export function GalleryDialog({
  title,
  children,
  onClose,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null),
    closeRef = useRef(onClose);
  closeRef.current = onClose;
  const id = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        ref.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]",
        ) || [],
      ).filter((item) => item.getClientRects().length > 0);
      const first = focusable[0],
        last = focusable.at(-1);
      if (!first) {
        event.preventDefault();
        return;
      }
      if (!ref.current?.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
        return;
      }
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === ref.current)
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          document.activeElement === ref.current)
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="gallery-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className={`gallery-modal ${className}`}
      >
        <header>
          <h2 id={id}>{title}</h2>
          <button type="button" aria-label="Close dialog" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
