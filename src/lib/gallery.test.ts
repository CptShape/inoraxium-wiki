import { describe, expect, it } from "vitest";
import {
  activeQueryToken,
  assignCharacterGalleryRole,
  characterGalleryImages,
  characterImageTagScopes,
  withCharacterImageTags,
  completeQueryToken,
  matchesGalleryQuery,
  normalizeTag,
  parseGalleryLinks,
  parseGalleryQuery,
  publicCharacterGallery,
  setQueryTag,
} from "./gallery";
import { CharacterData } from "../types/character";

describe("booru gallery search", () => {
  const image = {
    id: "a",
    url: "https://i.imgur.com/a.png",
    tags: ["Ayrton", "splash-art"],
  };
  it("requires every included tag and rejects any excluded tag", () => {
    expect(matchesGalleryQuery(image, "ayrton splash_art -nsfw")).toBe(true);
    expect(matchesGalleryQuery(image, "ayrton token")).toBe(false);
    expect(matchesGalleryQuery(image, "ayrton -splash_art")).toBe(false);
    expect(
      matchesGalleryQuery(
        { ...image, tags: [...image.tags, "nsfw"] },
        "ayrton splash_art -nsfw",
      ),
    ).toBe(false);
    expect(matchesGalleryQuery(image, "")).toBe(true);
  });
  it("normalizes whitespace, case and the old special splash-art tag", () => {
    expect(normalizeTag(" Ayrton Octappen ")).toBe("ayrton_octappen");
    expect([...parseGalleryQuery("  AYRTON  -NSFW\n")]).toEqual([
      ["ayrton", "include"],
      ["nsfw", "exclude"],
    ]);
    expect(setQueryTag("ayrton -nsfw", "ayrton", "exclude")).toBe(
      "-nsfw -ayrton",
    );
    expect(setQueryTag("ayrton -nsfw", "nsfw")).toBe("ayrton");
  });
  it("completes only the token at the caret, preserving exclusion and subsequent tokens", () => {
    expect(activeQueryToken("ayrton -ns", 10).text).toBe("-ns");
    expect(completeQueryToken("ayrton -ns", 10, "nsfw")).toEqual({
      value: "ayrton -nsfw ",
      caret: 13,
    });
    expect(completeQueryToken("ayr spl -nsfw", 6, "splash_art").value).toBe(
      "ayr splash_art -nsfw",
    );
    expect(completeQueryToken("ayrton ", 7, "splash_art").value).toBe(
      "ayrton splash_art ",
    );
  });
});

describe("character roles on linked global images", () => {
  const source = {
    id: "global-one",
    url: "https://i.imgur.com/one.png",
    tags: ["ayrton", "splash_art"],
  };
  it("keeps main and splash selections on the character, preserving global tags", () => {
    const originals = [
      {
        id: "old",
        url: "https://i.imgur.com/old.png",
        tags: ["main", "splash-art"],
      },
    ];
    const main = assignCharacterGalleryRole(originals, source, "main");
    const result = assignCharacterGalleryRole(main, source, "splash-art");
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({
      globalGalleryImageId: "global-one",
      tags: ["main", "splash-art"],
    });
    expect(result[0].tags).toEqual([]);
    expect(originals[0].tags).toEqual(["main", "splash-art"]);
    expect(source.tags).toEqual(["ayrton", "splash_art"]);
    const publicResult = publicCharacterGallery([
      {
        id: "character",
        name: "Ayrton",
        visibility: "public",
        gallery: result,
      } as CharacterData,
    ]);
    expect(publicResult.images).toHaveLength(1);
    expect(publicResult.images[0].url).toBe("https://i.imgur.com/old.png");
  });
  it("reuses a local image with the same URL and toggles token references off cleanly", () => {
    expect(
      assignCharacterGalleryRole(
        [{ id: "local", url: source.url, tags: [] }],
        source,
        "main",
      ),
    ).toEqual([{ id: "local", url: source.url, tags: ["main"] }]);
    const token = assignCharacterGalleryRole([], source, "token");
    expect(assignCharacterGalleryRole(token, source, "token")).toEqual([]);
    const main = assignCharacterGalleryRole([], source, "main");
    const next = assignCharacterGalleryRole(
      main,
      { ...source, id: "global-two", url: "https://i.imgur.com/two.png" },
      "main",
    );
    expect(next).toHaveLength(1);
    expect(next[0].url).toBe("https://i.imgur.com/two.png");
  });
});

describe("gallery link imports", () => {
  it("parses Imgur singles, direct images, Pixhost BBCode and removes duplicate thumbnails", () => {
    const result = parseGalleryLinks(
      "[url=https://pixhost.to/show/1/2_model.png][img]https://t3.pixhost.to/thumbs/1/2_model.png[/img][/url]\nhttps://imgur.com/abc123\nhttps://i.imgur.com/abc123.png\nhttps://i.imgur.com/second.webp",
    );
    expect(result.map((image) => image.url)).toEqual([
      "https://img3.pixhost.to/images/1/2_model.png",
      "https://i.imgur.com/abc123.png",
      "https://i.imgur.com/second.webp",
    ]);
    expect(result[0].thumbUrl).toBe(
      "https://t3.pixhost.to/thumbs/1/2_model.png",
    );
  });
  it("accepts Markdown thumbnail blocks and ignores non-image / album URLs", () => {
    expect(
      parseGalleryLinks(
        "[![image](https://t3.pixhost.to/thumbs/1/2_model.png)](https://pixhost.to/show/1/2_model.png)",
      )[0].url,
    ).toBe("https://img3.pixhost.to/images/1/2_model.png");
    expect(
      parseGalleryLinks(
        "https://imgur.com/a/album https://example.com/page javascript:alert(1)",
      ),
    ).toEqual([]);
  });
});

describe("character gallery connection", () => {
  const character = {
    id: "ayrton",
    name: "Ayrton",
    race: "Human",
    className: "Fighter",
    galleryCharacterTag: "ayrton_octappen",
    gallery: [
      { id: "old", url: "https://i.imgur.com/one.png", tags: ["main"] },
    ],
  } as CharacterData;
  it("combines matching global images with local images, merging duplicate tags", () => {
    const global = [
      {
        id: "new",
        userId: "u",
        url: "https://i.imgur.com/two.png",
        tags: ["ayrton_octappen"],
      },
      {
        id: "duplicate",
        userId: "u",
        url: "https://i.imgur.com/one.png",
        tags: ["ayrton_octappen"],
      },
      {
        id: "other",
        userId: "u",
        url: "https://i.imgur.com/other.png",
        tags: ["daria"],
      },
    ];
    const result = characterGalleryImages(character, global);
    expect(result).toHaveLength(2);
    expect(result.find((image) => image.id === "old")?.tags).toEqual([
      "main",
      "ayrton_octappen",
    ]);
    expect(
      characterGalleryImages({ ...character, galleryCharacterTag: "" }, global),
    ).toHaveLength(1);
  });
  it("never exposes private legacy characters in the shared archive", () => {
    const result = publicCharacterGallery([
      { ...character, visibility: "private" },
      {
        ...character,
        id: "public",
        visibility: "public",
        galleryTagCategories: { main: "meta" },
      },
    ]);
    expect(result.images).toHaveLength(1);
    expect(result.images[0].sourceCharacterId).toBe("public");
    expect(result.tags).toContainEqual({
      name: "ayrton_octappen",
      category: "character",
    });
  });
  it("matches any selected character tag, deduplicates matches and honors clearing an old selection", () => {
    const global = [
      {
        id: "a",
        userId: "u",
        url: "https://i.imgur.com/a.png",
        tags: ["ayrton_octappen"],
      },
      {
        id: "b",
        userId: "u",
        url: "https://i.imgur.com/b.png",
        tags: ["daria"],
      },
      {
        id: "c",
        userId: "u",
        url: "https://i.imgur.com/c.png",
        tags: ["ayrton_octappen", "daria"],
      },
      {
        id: "d",
        userId: "u",
        url: "https://i.imgur.com/d.png",
        tags: ["gideon"],
      },
    ];
    expect(
      characterGalleryImages(
        { ...character, galleryCharacterTags: ["ayrton_octappen", "daria"] },
        global,
      ),
    ).toHaveLength(4);
    expect(
      characterGalleryImages(
        { ...character, galleryCharacterTags: [] },
        global,
      ),
    ).toHaveLength(1);
    const legacy = publicCharacterGallery([
      {
        ...character,
        visibility: "public",
        galleryCharacterTags: ["ayrton_octappen", "daria"],
      },
    ]);
    expect(legacy.images[0].tags).toEqual(["ayrton_octappen", "daria"]);
    expect(legacy.images[0].inheritedTags).toEqual([
      "ayrton_octappen",
      "daria",
    ]);
  });
});

describe("character tag scopes", () => {
  it("keeps role selections and migrates legacy specific tags without publishing them", () => {
    const image = {
      id: "old",
      url: "https://i.imgur.com/old.png",
      tags: ["main", "splash-art", "armor", "Secret Plot"],
    };
    const categories = { "secret plot": "character-specific" as const };
    expect(characterImageTagScopes(image, categories)).toEqual({
      roles: ["main", "splash-art"],
      shared: ["armor"],
      specific: ["secret_plot"],
    });
    const next = withCharacterImageTags(
      image,
      ["armor", "new_tag"],
      ["secret_plot"],
      categories,
    );
    expect(next.tags).toEqual(["main", "splash-art", "armor", "new_tag"]);
    const published = publicCharacterGallery([
      {
        id: "char",
        name: "Character",
        race: "Human",
        className: "Fighter",
        visibility: "public",
        gallery: [next],
        galleryTagCategories: categories,
      } as CharacterData,
    ]);
    expect(published.images[0].tags).toEqual(["armor", "new_tag"]);
    expect(published.images[0].characterSpecificTags).toBeUndefined();
    expect(published.tags.map((tag) => tag.name)).not.toContain("secret_plot");
  });
});

it("uses current shared tags on character references without losing local roles or specific tags", () => {
  const character = { id: "char", name: "Character", race: "Human", className: "Fighter", gallery: [{ id: "reference", url: "https://i.imgur.com/ref.png", globalGalleryImageId: "shared", tags: ["main", "old_tag"], characterSpecificTags: ["local_secret"] }] } as CharacterData;
  const images = characterGalleryImages(character, [{ id: "shared", userId: "owner", url: "https://i.imgur.com/ref.png", tags: ["new_tag"] }]);
  expect(images[0].tags).toEqual(["main", "new_tag"]);
  expect(images[0].characterSpecificTags).toEqual(["local_secret"]);
  expect(characterImageTagScopes({ ...images[0], tags: ["main", "shared_name"], characterSpecificTags: [] }, { shared_name: "character-specific" }).specific).toEqual([]);
});
