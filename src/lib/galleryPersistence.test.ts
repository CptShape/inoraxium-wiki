import { beforeEach, describe, expect, it, vi } from "vitest";
const sdk = vi.hoisted(() => ({
  batchSet: vi.fn(),
  batchUpdate: vi.fn(),
  batchCommit: vi.fn(),
  deleteDoc: vi.fn(),
  onSnapshot: vi.fn(),
  getDoc: vi.fn(),
  transactionGet: vi.fn(),
  transactionUpdate: vi.fn(),
  transactionSet: vi.fn(),
  transactionDelete: vi.fn(),
  getDocs: vi.fn(),
}));
vi.mock("firebase/app", () => ({
  getApps: () => [{}],
  getApp: () => ({}),
  initializeApp: () => ({}),
}));
vi.mock("firebase/firestore", () => ({
  getFirestore: () => ({}),
  collection: (_db: unknown, ...parts: string[]) => parts.join("/"),
  doc: (_db: unknown, ...parts: string[]) => parts.join("/"),
  writeBatch: () => ({
    set: sdk.batchSet,
    update: sdk.batchUpdate,
    commit: sdk.batchCommit,
  }),
  deleteDoc: sdk.deleteDoc,
  onSnapshot: sdk.onSnapshot,
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  getDocs: sdk.getDocs,
  getDoc: sdk.getDoc,
  query: vi.fn(),
  where: vi.fn(),
  arrayUnion: vi.fn(),
  or: vi.fn(),
  runTransaction: async (
    _db: unknown,
    callback: (transaction: unknown) => unknown,
  ) =>
    callback({
      get: sdk.transactionGet,
      update: sdk.transactionUpdate,
      set: sdk.transactionSet,
      delete: sdk.transactionDelete,
    }),
}));
import {
  deleteGlobalGalleryImage,
  saveGlobalGallery,
  subscribeGlobalGallery,
  saveGalleryImageTags,
  saveCharacterGalleryImageTags,
  updateGalleryReaction,
  subscribeGalleryReactions,
  pruneUnusedGalleryTags,
} from "./firestore";

const post = {
  id: "image",
  userId: "uploader",
  url: "https://i.imgur.com/image.png",
  tags: ["AYRTON", "splash-art"],
  createdAt: 1,
};
beforeEach(() => {
  vi.clearAllMocks();
  sdk.batchCommit.mockResolvedValue(undefined);
  sdk.getDoc.mockResolvedValue({ exists: () => false });
  sdk.getDocs.mockResolvedValue({ docs: [], empty: true });
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  vi.stubGlobal("window", new EventTarget());
});
describe("global gallery persistence boundaries", () => {
  it("saves shared image metadata and tag definitions in one atomic batch", async () => {
    await saveGlobalGallery(
      "uploader",
      [post],
      [{ name: "AYRTON", category: "character" }],
    );
    expect(sdk.batchSet).toHaveBeenCalledWith(
      "galleryImages/image",
      expect.objectContaining({
        userId: "uploader",
        tags: ["ayrton", "splash_art"],
      }),
    );
    expect(sdk.batchSet).toHaveBeenCalledWith(
      "galleryTags/ayrton",
      { name: "ayrton", category: "character" },
      { merge: true },
    );
    expect(sdk.batchCommit).toHaveBeenCalledOnce();
  });
  it("does not claim a successful save or silently fall back to local when remote permission fails", async () => {
    sdk.batchCommit.mockRejectedValueOnce(new Error("permission-denied"));
    await expect(saveGlobalGallery("uploader", [post], [])).rejects.toThrow(
      "permission-denied",
    );
    expect(localStorage.getItem("eldritchGalleryV1")).toBeNull();
  });
  it("blocks modifying other uploaders and legacy character images", async () => {
    await expect(saveGlobalGallery("other", [post], [])).rejects.toThrow(
      "own global images",
    );
    await expect(
      saveGlobalGallery("uploader", [{ ...post, sourceCharacterId: "c" }], []),
    ).rejects.toThrow("own global images");
    await expect(deleteGlobalGalleryImage("other", post)).rejects.toThrow(
      "uploader",
    );
    expect(sdk.batchCommit).not.toHaveBeenCalled();
    expect(sdk.deleteDoc).not.toHaveBeenCalled();
  });
  it("keeps guest drafts local and notifies subscribers on save / delete", async () => {
    const images = vi.fn(),
      tags = vi.fn(),
      error = vi.fn();
    const cleanup = subscribeGlobalGallery("guest", images, tags, error);
    await saveGlobalGallery(
      "guest",
      [{ ...post, userId: "guest" }],
      [{ name: "ayrton", category: "character" }],
    );
    expect(images).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: "image" }),
    ]);
    expect(tags).toHaveBeenLastCalledWith([
      { name: "ayrton", category: "character" },
    ]);
    await deleteGlobalGalleryImage("guest", { ...post, userId: "guest" });
    expect(images).toHaveBeenLastCalledWith([]);
    cleanup();
    expect(error).not.toHaveBeenCalled();
    expect(sdk.batchCommit).not.toHaveBeenCalled();
  });
  it("rejects over-limit batches before writing", async () => {
    await expect(
      saveGlobalGallery(
        "uploader",
        Array.from({ length: 101 }, () => post),
        [],
      ),
    ).rejects.toThrow("100 images");
    expect(sdk.batchCommit).not.toHaveBeenCalled();
  });
  it("removes unused local tags after the last image tag or image is removed", async () => {
    await saveGlobalGallery(
      "guest",
      [{ ...post, userId: "guest", tags: ["ayrton", "armor"] }],
      [
        { name: "ayrton", category: "character" },
        { name: "armor", category: "general" },
      ],
    );
    await saveGalleryImageTags(
      "guest",
      { ...post, userId: "guest" },
      ["ayrton"],
      [],
    );
    expect(
      JSON.parse(localStorage.getItem("eldritchGalleryV1")!).tags.map(
        (tag: any) => tag.name,
      ),
    ).toEqual(["ayrton"]);
    await deleteGlobalGalleryImage("guest", { ...post, userId: "guest" });
    expect(JSON.parse(localStorage.getItem("eldritchGalleryV1")!).tags).toEqual(
      [],
    );
  });
  it("rechecks shared image usage before deleting an unused tag definition", async () => {
    sdk.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ admin: true }),
    });
    sdk.transactionGet.mockResolvedValue({ exists: () => true });
    await pruneUnusedGalleryTags("admin", ["old_tag"]);
    expect(sdk.transactionDelete).toHaveBeenCalledWith("galleryTags/old_tag");
    sdk.transactionDelete.mockClear();
    sdk.getDocs
      .mockResolvedValueOnce({ docs: [], empty: true })
      .mockResolvedValueOnce({
        docs: [{ data: () => ({ tags: ["old_tag"] }) }],
        empty: false,
      });
    await pruneUnusedGalleryTags("admin", ["old_tag"]);
    expect(sdk.transactionDelete).not.toHaveBeenCalled();
  });
  it("preserves tags used by public legacy images and leaves cleanup to admins", async () => {
    sdk.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ admin: true }),
    });
    sdk.getDocs.mockResolvedValue({
      docs: [
        {
          id: "legacy",
          data: () => ({
            visibility: "public",
            gallery: [{ id: "image", url: post.url, tags: ["old_tag"] }],
          }),
        },
      ],
    });
    await pruneUnusedGalleryTags("admin", ["old_tag"]);
    expect(sdk.transactionDelete).not.toHaveBeenCalled();
    sdk.getDoc.mockResolvedValue({ exists: () => false });
    sdk.getDocs.mockClear();
    await pruneUnusedGalleryTags("other", ["old_tag"]);
    expect(sdk.getDocs).not.toHaveBeenCalled();
  });
  it("allows an administrator to update tags on another uploader without replacing their metadata", async () => {
    sdk.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ admin: true }),
    });
    await saveGalleryImageTags(
      "admin",
      post,
      ["armor", "AYRTON"],
      [{ name: "armor", category: "general" }],
    );
    expect(sdk.batchUpdate).toHaveBeenCalledWith("galleryImages/image", {
      tags: ["armor", "ayrton"],
      updatedAt: expect.any(Number),
    });
    expect(sdk.batchSet).not.toHaveBeenCalledWith(
      "galleryImages/image",
      expect.anything(),
    );
  });
  it("rejects non-admin edits of another uploader and propagates server rejection for admins", async () => {
    await expect(saveGalleryImageTags("other", post, [], [])).rejects.toThrow(
      "administrator",
    );
    expect(sdk.batchCommit).not.toHaveBeenCalled();
    sdk.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ admin: true }),
    });
    sdk.batchCommit.mockRejectedValueOnce(new Error("permission-denied"));
    await expect(saveGalleryImageTags("admin", post, [], [])).rejects.toThrow(
      "permission-denied",
    );
  });
  it("updates only the selected legacy image in a transaction and preserves special tag spelling", async () => {
    sdk.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ admin: true }),
    });
    const other = {
      id: "other-image",
      url: "https://i.imgur.com/other.png",
      tags: ["untouched"],
    };
    sdk.transactionGet.mockResolvedValue({
      exists: () => true,
      data: () => ({
        gallery: [
          { id: "original", url: post.url, tags: ["splash-art", "remove_me"] },
          other,
        ],
        galleryTagCategories: { untouched: "meta" },
      }),
    });
    await saveGalleryImageTags(
      "admin",
      { ...post, sourceCharacterId: "character", sourceImageId: "original" },
      ["splash_art", "armor"],
      [{ name: "armor", category: "general" }],
    );
    const patch = sdk.transactionUpdate.mock.calls[0][1];
    expect(patch.gallery).toEqual([
      { id: "original", url: post.url, tags: ["splash-art", "armor"] },
      other,
    ]);
    expect(patch.galleryTagCategories).toEqual({
      untouched: "meta",
      armor: "general",
    });
    expect(sdk.batchCommit).not.toHaveBeenCalled();
  });
});

describe("character to global tag publishing", () => {
  const image = {
    id: "legacy",
    url: "https://i.imgur.com/legacy.png",
    label: "Private portrait",
    tags: ["main"],
  };
  const character = {
    id: "character",
    userId: "guest",
    visibility: "private",
    gallery: [image],
    name: "Keep my name",
  };
  it("publishes a private image when a global tag is added, while keeping character-specific tags local", async () => {
    localStorage.setItem(
      "battleTrackerLocalCharacters",
      JSON.stringify([character]),
    );
    const next = await saveCharacterGalleryImageTags(
      "guest",
      "character",
      image,
      ["New Tag"],
      ["secret"],
      [{ name: "new_tag", category: "meta" }],
      {},
    );
    const global = JSON.parse(localStorage.getItem("eldritchGalleryV1")!);
    expect(global.images).toHaveLength(1);
    expect(global.images[0]).toMatchObject({
      userId: "guest",
      tags: ["new_tag"],
      label: image.label,
    });
    expect(global.images[0].characterSpecificTags).toBeUndefined();
    expect(global.tags).toEqual([{ name: "new_tag", category: "meta" }]);
    const saved = JSON.parse(
      localStorage.getItem("battleTrackerLocalCharacters")!,
    )[0];
    expect(saved).toMatchObject({
      visibility: "private",
      name: "Keep my name",
    });
    expect(saved.gallery[0]).toMatchObject({
      tags: ["main", "new_tag"],
      characterSpecificTags: ["secret"],
      globalGalleryImageId: global.images[0].id,
    });
    expect(next.tags).toEqual(["main", "new_tag"]);
  });
  it("does not publish an image when only character-specific tags change", async () => {
    localStorage.setItem(
      "battleTrackerLocalCharacters",
      JSON.stringify([character]),
    );
    await saveCharacterGalleryImageTags(
      "guest",
      "character",
      image,
      [],
      ["secret"],
      [],
      {},
    );
    expect(
      JSON.parse(localStorage.getItem("eldritchGalleryV1")!).images,
    ).toEqual([]);
    expect(
      JSON.parse(localStorage.getItem("battleTrackerLocalCharacters")!)[0]
        .gallery[0].characterSpecificTags,
    ).toEqual(["secret"]);
  });
  it("updates shared tags and the selected character image in one transaction without replacing other fields", async () => {
    const central = { ...post, tags: ["armor"] };
    sdk.transactionGet.mockImplementation(async (ref: string) => ({
      exists: () => true,
      data: () =>
        ref.startsWith("characters/")
          ? {
              ...character,
              gallery: [
                image,
                { id: "other", url: "https://i.imgur.com/other.png" },
              ],
            }
          : central,
    }));
    await saveCharacterGalleryImageTags(
      "uploader",
      "character",
      image,
      ["armor", "new_tag"],
      ["secret"],
      [{ name: "new_tag", category: "meta" }],
      {},
      central,
    );
    expect(sdk.transactionUpdate).toHaveBeenCalledWith("galleryImages/image", {
      tags: ["armor", "new_tag"],
      updatedAt: expect.any(Number),
    });
    expect(sdk.transactionUpdate).toHaveBeenCalledWith(
      "characters/character",
      expect.objectContaining({
        gallery: [
          expect.objectContaining({
            tags: ["main", "armor", "new_tag"],
            characterSpecificTags: ["secret"],
          }),
          { id: "other", url: "https://i.imgur.com/other.png" },
        ],
      }),
    );
    expect(sdk.transactionUpdate.mock.calls[0][1]).not.toHaveProperty("name");
  });
  it("lets character owners save local tags without editing another uploader's global post", async () => {
    const central = { ...post, userId: "other", tags: ["armor"] };
    sdk.transactionGet.mockResolvedValue({
      exists: () => true,
      data: () => character,
    });
    await saveCharacterGalleryImageTags(
      "owner",
      "character",
      image,
      ["armor"],
      ["secret"],
      [],
      {},
      central,
      false,
    );
    expect(sdk.transactionUpdate).toHaveBeenCalledTimes(1);
    expect(sdk.transactionSet).not.toHaveBeenCalled();
    await expect(
      saveCharacterGalleryImageTags(
        "owner",
        "character",
        image,
        ["changed"],
        [],
        [],
        {},
        central,
      ),
    ).rejects.toThrow("administrator");
  });
  it("propagates transaction failures without writing a local success", async () => {
    sdk.transactionGet.mockRejectedValueOnce(new Error("permission-denied"));
    await expect(
      saveCharacterGalleryImageTags(
        "owner",
        "character",
        image,
        ["new_tag"],
        [],
        [],
        {},
      ),
    ).rejects.toThrow("permission-denied");
    expect(sdk.transactionSet).not.toHaveBeenCalled();
    expect(localStorage.getItem("eldritchGalleryV1")).toBeNull();
  });
});

describe("gallery reactions", () => {
  it("atomically records one like per user and changes the shared total", async () => {
    sdk.transactionGet.mockImplementation(async (ref: string) => ({
      exists: () => ref.startsWith("galleryLikeCounts/"),
      data: () => ({ likes: 7 }),
    }));
    await updateGalleryReaction("reader", post, "like");
    expect(sdk.transactionSet).toHaveBeenCalledWith(
      expect.stringMatching(/^users\/reader\/galleryReactions\/[a-f0-9]{64}$/),
      expect.objectContaining({ liked: true, favorite: false, rockets: 0 }),
    );
    expect(sdk.transactionSet).toHaveBeenCalledWith(
      expect.stringMatching(/^galleryLikeCounts\//),
      { likes: 8 },
    );
    sdk.transactionSet.mockClear();
    sdk.transactionGet.mockImplementation(async (ref: string) => ({
      exists: () => true,
      data: () =>
        ref.startsWith("galleryLikeCounts/")
          ? { likes: 8 }
          : { liked: true, favorite: true, rockets: 12 },
    }));
    await updateGalleryReaction("reader", post, "like");
    expect(sdk.transactionSet).toHaveBeenCalledWith(
      expect.stringMatching(/^galleryLikeCounts\//),
      { likes: 7 },
    );
    expect(sdk.transactionSet).toHaveBeenCalledWith(
      expect.stringMatching(/^users\/reader/),
      expect.objectContaining({ liked: false, favorite: true, rockets: 12 }),
    );
  });
  it("increments personal rockets without touching public counts or other users", async () => {
    sdk.transactionGet.mockResolvedValue({
      exists: () => true,
      data: () => ({ liked: true, favorite: true, rockets: 21 }),
    });
    await updateGalleryReaction("reader", post, "rocket");
    expect(sdk.transactionSet).toHaveBeenCalledTimes(1);
    expect(sdk.transactionSet).toHaveBeenCalledWith(
      expect.stringMatching(/^users\/reader/),
      expect.objectContaining({ rockets: 22, liked: true, favorite: true }),
    );
  });
  it("retries stale like totals only when fresh reads prove a concurrent change", async () => {
    const empty = { exists: () => false };
    sdk.transactionGet
      .mockResolvedValueOnce(empty)
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ likes: 3 }) })
      .mockResolvedValueOnce(empty)
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ likes: 4 }),
      });
    sdk.getDoc.mockImplementation(async (ref: string) =>
      ref.startsWith("galleryLikeCounts/")
        ? { exists: () => true, data: () => ({ likes: 4 }) }
        : empty,
    );
    sdk.transactionSet.mockImplementationOnce(() => {
      throw Object.assign(new Error("stale count"), {
        code: "permission-denied",
      });
    });
    await updateGalleryReaction("reader", post, "like");
    expect(sdk.transactionSet).toHaveBeenLastCalledWith(
      expect.stringMatching(/^galleryLikeCounts\//),
      { likes: 5 },
    );
  });
  it("retries a rocket click after another tab changed the same personal counter", async () => {
    sdk.transactionGet
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ liked: false, favorite: false, rockets: 7 }),
      })
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ liked: false, favorite: true, rockets: 9 }),
      });
    sdk.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ liked: false, favorite: true, rockets: 9 }),
    });
    sdk.transactionSet.mockImplementationOnce(() => {
      throw Object.assign(new Error("stale reaction"), {
        code: "permission-denied",
      });
    });
    await updateGalleryReaction("reader", post, "rocket");
    expect(sdk.transactionSet).toHaveBeenLastCalledWith(
      expect.stringMatching(/^users\/reader/),
      expect.objectContaining({ rockets: 10, favorite: true }),
    );
  });
  it("persists guest favorites and counts every rapid rocket press", async () => {
    await updateGalleryReaction("guest", post, "favorite");
    await Promise.all(
      Array.from({ length: 12 }, () =>
        updateGalleryReaction("guest", post, "rocket"),
      ),
    );
    await updateGalleryReaction("guest", post, "like");
    const data = JSON.parse(
      localStorage.getItem("eldritchGalleryReactionsV1")!,
    );
    const key = Object.keys(data.reactions)[0];
    expect(data.reactions[key]).toMatchObject({
      rockets: 12,
      liked: true,
      favorite: true,
    });
    expect(data.counts[key].likes).toBe(1);
    await updateGalleryReaction("guest", post, "like");
    await updateGalleryReaction("guest", post, "favorite");
    const updated = JSON.parse(
      localStorage.getItem("eldritchGalleryReactionsV1")!,
    );
    expect(updated.reactions[key]).toMatchObject({
      rockets: 12,
      liked: false,
      favorite: false,
    });
    expect(updated.counts[key].likes).toBe(0);
  });
  it("subscribes only to the current user's private reactions and unsubscribes", async () => {
    const stop = vi.fn();
    sdk.onSnapshot.mockReturnValue(stop);
    const unsubscribe = subscribeGalleryReactions(
      "reader",
      vi.fn(),
      vi.fn(),
      vi.fn(),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sdk.onSnapshot).toHaveBeenCalledWith(
      "users/reader/galleryReactions",
      expect.any(Function),
      expect.any(Function),
    );
    expect(sdk.onSnapshot).toHaveBeenCalledWith(
      "galleryLikeCounts",
      expect.any(Function),
      expect.any(Function),
    );
    unsubscribe();
    expect(stop).toHaveBeenCalledTimes(2);
  });
  it("rejects anonymous writes and propagates database errors", async () => {
    await expect(updateGalleryReaction(null, post, "rocket")).rejects.toThrow(
      "Sign in",
    );
    sdk.transactionGet.mockRejectedValueOnce(new Error("permission-denied"));
    await expect(
      updateGalleryReaction("reader", post, "favorite"),
    ).rejects.toThrow("permission-denied");
    expect(sdk.transactionSet).not.toHaveBeenCalled();
  });
});
