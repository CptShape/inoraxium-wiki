import {
  CharacterData,
  CharacterGalleryImage,
  CharacterGalleryTagCategory,
} from "../types/character";
import { getPixhostDirectImageUrl, isDirectImageUrl } from "./pixhost";
import { apiUrl } from "./api";

export interface GalleryTag {
  name: string;
  category: CharacterGalleryTagCategory;
}
export interface GalleryPost extends CharacterGalleryImage {
  userId: string;
  updatedAt?: number;
  sourceCharacterId?: string;
  sourceCharacterName?: string;
  sourceImageId?: string;
  inheritedTags?: string[];
}
export const GALLERY_CATEGORIES: CharacterGalleryTagCategory[] = [
  "character",
  "meta",
  "general",
  "character-specific",
];
export const GALLERY_CATEGORY_LABELS: Record<
  CharacterGalleryTagCategory,
  string
> = {
  character: "Character",
  meta: "Meta",
  general: "General Tags",
  "character-specific": "Character Specific",
};
export const normalizeTag = (value: string) => {
  const name = value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/^-+/, "")
    .slice(0, 64);
  return name === "splash-art" ? "splash_art" : name;
};
export const imageTags = (image: CharacterGalleryImage) => [
  ...new Set((image.tags || []).map(normalizeTag).filter(Boolean)),
];
export const characterImageTagScopes = (
  image: CharacterGalleryImage,
  categories: Record<string, CharacterGalleryTagCategory> = {},
) => {
  const normalized = Object.fromEntries(
    Object.entries(categories).map(([name, category]) => [
      normalizeTag(name),
      category,
    ]),
  );
  const roles = (image.tags || []).filter((tag) =>
    ["main", "splash-art", "token"].includes(tag),
  );
  const shared = imageTags(image).filter(
    (tag) =>
      !roles.some((role) => normalizeTag(role) === tag) &&
      (image.characterSpecificTags !== undefined ||
        normalized[tag] !== "character-specific"),
  );
  const specific = [
    ...new Set(
      [
        ...(image.characterSpecificTags || []).map(normalizeTag),
        ...(image.characterSpecificTags === undefined
          ? imageTags(image).filter(
              (tag) => normalized[tag] === "character-specific",
            )
          : []),
      ].filter(Boolean),
    ),
  ];
  return { roles, shared, specific };
};
export const withCharacterImageTags = (
  image: CharacterGalleryImage,
  shared: string[],
  specific: string[],
  categories: Record<string, CharacterGalleryTagCategory> = {},
): CharacterGalleryImage => ({
  ...image,
  tags: [
    ...new Set([
      ...characterImageTagScopes(image, categories).roles,
      ...shared.map(normalizeTag).filter(Boolean),
    ]),
  ],
  characterSpecificTags: [
    ...new Set(specific.map(normalizeTag).filter(Boolean)),
  ],
});
export const galleryImageUrl = (image: CharacterGalleryImage) =>
  isDirectImageUrl(image.url)
    ? image.url
    : getPixhostDirectImageUrl(image.url, image.thumbUrl || "");

export type CharacterGalleryRole = "main" | "splash-art" | "token";
export const assignCharacterGalleryRole = (
  images: CharacterGalleryImage[],
  source: CharacterGalleryImage,
  role: CharacterGalleryRole,
): CharacterGalleryImage[] => {
  const existing = images.find(
    (image) => galleryImageUrl(image) === galleryImageUrl(source),
  );
  const target = existing || {
    id: `global-role:${source.id}`,
    url: galleryImageUrl(source),
    thumbUrl: source.thumbUrl || galleryImageUrl(source),
    label: source.label || "",
    createdAt: source.createdAt || Date.now(),
    tags: [],
    globalGalleryImageId: source.id,
  };
  return (existing ? images : [...images, target])
    .map((image) => {
      const tags = image.tags || [];
      if (role === "main" || role === "splash-art")
        return {
          ...image,
          tags:
            image.id === target.id
              ? [...new Set([...tags, role])]
              : tags.filter((tag) => tag !== role),
        };
      return image.id !== target.id
        ? image
        : {
            ...image,
            tags: tags.includes(role)
              ? tags.filter((tag) => tag !== role)
              : [...tags, role],
          };
    })
    .filter(
      (image) =>
        !image.globalGalleryImageId ||
        (image.tags || []).length > 0 ||
        (image.characterSpecificTags || []).length > 0,
    );
};

export const usedGalleryTagNames = (
  images: CharacterGalleryImage[],
): Set<string> => new Set(images.flatMap(imageTags));
export const parseGalleryQuery = (
  query: string,
): Map<string, "include" | "exclude"> => {
  const terms = new Map<string, "include" | "exclude">();
  query
    .split(/\s+/)
    .filter(Boolean)
    .forEach((term) => {
      const name = normalizeTag(term);
      if (name) terms.set(name, term.startsWith("-") ? "exclude" : "include");
    });
  return terms;
};
export const matchesGalleryQuery = (
  image: CharacterGalleryImage,
  query: string,
) => {
  const tags = new Set(imageTags(image));
  return [...parseGalleryQuery(query)].every(([tag, mode]) =>
    mode === "include" ? tags.has(tag) : !tags.has(tag),
  );
};
export const setQueryTag = (
  query: string,
  tag: string,
  mode?: "include" | "exclude",
) => {
  const terms = parseGalleryQuery(query);
  const name = normalizeTag(tag);
  terms.delete(name);
  if (mode) terms.set(name, mode);
  return [...terms]
    .map(([name, state]) => (state === "exclude" ? "-" : "") + name)
    .join(" ");
};
export const activeQueryToken = (query: string, caret: number) => {
  const start = query.slice(0, caret).search(/\S*$/);
  const suffix = query.slice(caret).match(/^\S*/)?.[0] || "";
  return {
    start,
    end: caret + suffix.length,
    text: query.slice(start, caret + suffix.length),
  };
};
export const completeQueryToken = (
  query: string,
  caret: number,
  tag: string,
) => {
  const token = activeQueryToken(query, caret);
  const replacement =
    (token.text.startsWith("-") ? "-" : "") + normalizeTag(tag) + " ";
  return {
    value:
      query.slice(0, token.start) +
      replacement +
      query.slice(token.end).replace(/^\s+/, ""),
    caret: token.start + replacement.length,
  };
};
export const mergeGalleryImages = (
  ...groups: CharacterGalleryImage[][]
): CharacterGalleryImage[] => {
  const images = new Map<string, CharacterGalleryImage>();
  groups.flat().forEach((image) => {
    const key = galleryImageUrl(image);
    if (!key) return;
    const old = images.get(key);
    images.set(
      key,
      old
        ? {
            ...old,
            tags: [...new Set([...imageTags(old), ...imageTags(image)])],
          }
        : image,
    );
  });
  return [...images.values()].sort(
    (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
  );
};
export const getCharacterGalleryTags = (
  character: Pick<
    CharacterData,
    "galleryCharacterTag" | "galleryCharacterTags"
  >,
): string[] => [
  ...new Set(
    (
      character.galleryCharacterTags ??
      (character.galleryCharacterTag ? [character.galleryCharacterTag] : [])
    )
      .map(normalizeTag)
      .filter(Boolean),
  ),
];

export const characterGalleryImages = (
  character: CharacterData,
  global: GalleryPost[],
) =>
  mergeGalleryImages(
    (character.gallery || []).map((image) => {
      const post = image.globalGalleryImageId
        ? global.find(
            (post) =>
              post.id === image.globalGalleryImageId ||
              galleryImageUrl(post) === galleryImageUrl(image),
          )
        : undefined;
      return post
        ? {
            ...image,
            tags: [
              ...characterImageTagScopes(image, character.galleryTagCategories)
                .roles,
              ...imageTags(post),
            ],
          }
        : image;
    }),
    getCharacterGalleryTags(character).length
      ? global.filter((post) =>
          getCharacterGalleryTags(character).some((tag) =>
            imageTags(post).includes(tag),
          ),
        )
      : [],
  );

/** Reuse public legacy galleries without copying private character data to the public collection. */
export const publicCharacterGallery = (
  characters: CharacterData[],
): { images: GalleryPost[]; tags: GalleryTag[] } => {
  const images: GalleryPost[] = [],
    tags: GalleryTag[] = [];
  characters
    .filter((character) => character.visibility === "public")
    .forEach((character) => {
      const connectionTags = getCharacterGalleryTags(character);
      (character.gallery || [])
        .filter((image) => !image.globalGalleryImageId)
        .forEach((image) => {
          const scoped = characterImageTagScopes(
            image,
            character.galleryTagCategories,
          );
          const names = [...new Set([...scoped.shared, ...connectionTags])];
          const { characterSpecificTags: _specific, ...publicImage } = image;
          images.push({
            ...publicImage,
            id: `character:${character.id}:${image.id}`,
            tags: names,
            userId: character.userId || "",
            sourceCharacterId: character.id,
            sourceCharacterName: character.name,
            sourceImageId: image.id,
            inheritedTags: connectionTags.filter(
              (tag) => !imageTags(image).includes(tag),
            ),
          });
          const categories = Object.fromEntries(
            Object.entries(character.galleryTagCategories || {}).map(
              ([name, category]) => [normalizeTag(name), category],
            ),
          );
          names.forEach((name) =>
            tags.push({
              name,
              category: connectionTags.includes(name)
                ? "character"
                : categories[name] || "general",
            }),
          );
        });
    });
  return { images, tags };
};

/** Accept Pixhost BBCode / Markdown, direct image URLs and Imgur single-image links. */
export const parseGalleryLinks = (
  raw: string,
): Array<Pick<GalleryPost, "url" | "thumbUrl" | "label">> => {
  const text = raw
    .replace(/\\([_\[\]])/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&#x20;/g, " ");
  const result = new Map<
    string,
    Pick<GalleryPost, "url" | "thumbUrl" | "label">
  >();
  const add = (url: string, thumbUrl = url) => {
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) return;
      if (
        /^(www\.)?imgur\.com$/i.test(parsed.hostname) &&
        /^\/[a-z0-9]+(?:\.(?:png|jpg|jpeg|gif|webp|avif))?$/i.test(
          parsed.pathname,
        )
      ) {
        parsed.hostname = "i.imgur.com";
        if (!/\.[a-z]+$/i.test(parsed.pathname)) parsed.pathname += ".png";
        url = parsed.toString();
        thumbUrl = url;
      }
      const direct = getPixhostDirectImageUrl(url, thumbUrl);
      if (!isDirectImageUrl(direct)) return;
      if (!result.has(direct))
        result.set(direct, { url: direct, thumbUrl, label: "" });
    } catch {
      /* Non-image text is ignored. */
    }
  };
  const pairs =
    /\[url=(https?:\/\/pixhost\.to\/show\/[^\]\s]+)\]\[img\](https?:\/\/[^\]\s]+)\[\/img\]\[\/url\]/gi;
  const unpaired = text.replace(pairs, (_all, url: string, thumb: string) => {
    add(url, thumb);
    return "";
  });
  for (const match of unpaired.matchAll(/https?:\/\/[^\s<>"'\[\]()]+/gi)) {
    if (/^https?:\/\/t\d+\.pixhost\.to\/thumbs\//i.test(match[0])) {
      add(getPixhostDirectImageUrl("", match[0]), match[0]);
      continue;
    }
    add(match[0]);
  }
  return [...result.values()];
};

export const resolveGalleryLinks = async (raw: string) => {
  const images = parseGalleryLinks(raw);
  const shows = [
    ...new Set(
      raw
        .replace(/\\([_\[\]])/g, "$1")
        .match(/https:\/\/(?:www\.)?pixhost\.to\/show\/[^\s\]\)<>"']+/gi) || [],
    ),
  ];
  const unresolved = shows.filter(
    (show) =>
      !images.some(
        (image) =>
          new URL(image.url).pathname ===
          new URL(show).pathname.replace(/^\/show\//, "/images/"),
      ),
  );
  if (unresolved.length > 100)
    throw new Error("Import up to 100 image links at a time.");
  // Sequential resolution keeps requests to the host bounded for large pastes.
  for (const url of unresolved) {
    const response = await fetch(apiUrl("/api/pixhost-image"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = await response.json();
    if (!response.ok || !isDirectImageUrl(data.url || ""))
      throw new Error(
        data.error ||
          "Pixhost link could not be resolved. Use its full BBCode.",
      );
    images.push({
      url: data.url,
      thumbUrl: data.thumbUrl || data.url,
      label: "",
    });
  }
  return images;
};
