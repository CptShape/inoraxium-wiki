import { expect, test } from "@playwright/test";
import path from "node:path";

test.beforeEach(async ({ page }) => {
  await page.route("**/src/lib/auth.ts", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export const authProvider = { getUid: () => 'guest', getDisplayName: () => 'Gallery QA', onAuthChange: cb => { cb({uid:'guest',displayName:'Gallery QA',email:null}); return () => {}; } };`,
    }),
  );
  await page.route("**/src/lib/firestore.ts", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `
    export * from './firestore.ts?galleryActual';
    import { subscribeGalleryReactions as localReactions } from './firestore.ts?galleryActual';
    export const subscribeGalleryReactions = (uid, ...callbacks) => localReactions('guest', ...callbacks);
    const characters = () => JSON.parse(localStorage.getItem('battleTrackerLocalCharacters') || '[]');
    export const loadCharacters = async () => characters();
    export const loadFavorites = async () => [];
    export const loadAdminAccess = async () => ({isAdmin: false, source: 'none'});
    export const loadUserDiceSettings = async () => ({macros: [], webhookUrl: '', autoSend: false});
    export const subscribeCharacterById = (id, uid, cb) => { cb(characters().find(c => c.id === id) || null); return () => {}; };
  `,
    }),
  );
  await page.route(
    /^https:\/\/(i\.imgur\.com|(?:img|t)\d+\.pixhost\.to)\//,
    (route) =>
      route.fulfill({
        path: path.resolve("public/resources/races/wood-elf.png"),
      }),
  );
  await page.addInitScript(() => {
    if (localStorage.getItem("galleryQASeeded")) return;
    localStorage.setItem("galleryQASeeded", "true");
    const tags = [
      { name: "ayrton_octappen", category: "character" },
      { name: "daria", category: "character" },
      { name: "splash_art", category: "meta" },
      { name: "nsfw", category: "meta" },
      { name: "armor", category: "general" },
      { name: "ayrton_uniform", category: "character-specific" },
    ];
    const images = [
      {
        id: "one",
        label: "Ayrton portrait",
        tags: ["ayrton_octappen", "splash_art", "armor"],
      },
      {
        id: "two",
        label: "Ayrton private scene",
        tags: ["ayrton_octappen", "splash_art", "nsfw"],
      },
      { id: "three", label: "Daria portrait", tags: ["daria", "splash_art"] },
      {
        id: "four",
        label: "Ayrton uniform",
        tags: ["ayrton_octappen", "ayrton_uniform"],
      },
    ].map((image, index) => ({
      ...image,
      url: "https://i.imgur.com/" + image.id + ".png",
      thumbUrl: "https://i.imgur.com/" + image.id + ".png",
      userId: "guest",
      createdAt: index + 1,
    }));
    localStorage.setItem("eldritchGalleryV1", JSON.stringify({ images, tags }));
    localStorage.setItem(
      "battleTrackerLocalCharacters",
      JSON.stringify([
        {
          id: "gallery-character",
          name: "Ayrton QA",
          race: "Human",
          className: "Fighter",
          userId: "guest",
          visibility: "private",
          sendToSpreadsheet: false,
          gallery: [
            {
              id: "legacy",
              url: "https://i.imgur.com/legacy.png",
              label: "Old local portrait",
              tags: ["main"],
            },
          ],
        },
      ]),
    );
  });
  page.on("dialog", (dialog) => dialog.accept());
  page.on("pageerror", (error) => {
    throw error;
  });
});

test("booru autocomplete, include/exclude filters, share link and lightbox", async ({
  page,
}) => {
  await page.goto("#tools/gallery");
  await expect(
    page.getByRole("heading", { name: "Gallery", exact: true }),
  ).toBeVisible();
  const search = page.getByRole("combobox", { name: "Search gallery tags" });
  await search.fill("ayrton_octappen spl");
  await page.getByRole("option").filter({ hasText: "splash_art" }).click();
  await expect(search).toHaveValue("ayrton_octappen splash_art ");
  await search.press("End");
  await search.pressSequentially("-ns");
  await page.getByRole("option").filter({ hasText: "nsfw" }).click();
  await expect(search).toHaveValue("ayrton_octappen splash_art -nsfw ");
  await expect(page.locator(".gallery-card")).toHaveCount(1);
  await expect(page.locator(".gallery-card")).toContainText("Ayrton portrait");
  await expect(page).toHaveURL(/gallery_q=/);
  await page
    .getByRole("button", { name: "Open image Ayrton portrait", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Fit · 125%" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  const tag = page.getByRole("button", {
    name: "Filter tag ayrton_octappen",
    exact: true,
  });
  await tag.click();
  await expect(tag).toHaveAttribute("data-state", "include");
  await expect(page.locator(".gallery-card")).toHaveCount(3);
  await tag.dblclick();
  await expect(tag).toHaveAttribute("data-state", "exclude");
  await expect(page.locator(".gallery-card")).toHaveCount(1);
  await expect(page.locator(".gallery-card")).toContainText("Daria portrait");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    (await page.locator(".global-gallery").boundingBox())!.width,
  ).toBeGreaterThan(380);
  await page.getByRole("button", { name: "Tags", exact: true }).click();
  await expect(tag).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("bulk link preview keeps individual tags, new categories and edits after reload", async ({
  page,
}) => {
  await page.goto("#tools/gallery");
  await page
    .getByRole("button", { name: "Add images", exact: true })
    .first()
    .click();
  let dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Imgur / Pixhost links or BBCode")
    .fill(
      "https://imgur.com/newone\n[url=https://pixhost.to/show/1/2_newtwo.png][img]https://t3.pixhost.to/thumbs/1/2_newtwo.png[/img][/url]",
    );
  await dialog.getByRole("button", { name: "Preview links" }).click();
  await expect(dialog.locator(".gallery-draft")).toHaveCount(2);
  const first = dialog.locator(".gallery-draft").nth(0),
    second = dialog.locator(".gallery-draft").nth(1);
  await first
    .getByRole("combobox", {
      name: "Image 1 tags: select or create tag",
      exact: true,
    })
    .fill("ayrton_octappen");
  await first.getByRole("button", { name: "Add tag", exact: true }).click();
  await first
    .getByRole("combobox", {
      name: "Image 1 tags: select or create tag",
      exact: true,
    })
    .fill("new_uniform");
  await first
    .getByRole("combobox", {
      name: "Image 1 tags: select or create tag",
      exact: true,
    })
    .press("Escape");
  await first
    .getByLabel("Image 1 tags: new tag category")
    .selectOption("character-specific");
  await first.getByRole("button", { name: "Add tag", exact: true }).click();
  await second
    .getByRole("combobox", {
      name: "Image 2 tags: select or create tag",
      exact: true,
    })
    .fill("daria");
  await second.getByRole("button", { name: "Add tag", exact: true }).click();
  await first.getByLabel("Image 1 label").fill("New Ayrton scene");
  await second.getByLabel("Image 2 label").fill("New Daria scene");
  await dialog
    .getByRole("button", { name: "Save to this browser", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("eldritchGalleryV1")!),
  );
  expect(
    stored.images.find((image: any) => image.label === "New Ayrton scene").tags,
  ).toEqual(["ayrton_octappen", "new_uniform"]);
  expect(
    stored.images.find((image: any) => image.label === "New Daria scene").tags,
  ).toEqual(["daria"]);
  expect(stored.tags).toContainEqual({
    name: "new_uniform",
    category: "character-specific",
  });
  await page.reload();
  await expect(page.locator(".gallery-card")).toHaveCount(6);
  await page
    .getByRole("button", { name: "Open image New Ayrton scene", exact: true })
    .click();
  await page.getByRole("button", { name: "Edit tags & label" }).click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Remove tag new_uniform", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await page
    .getByRole("button", { name: "Open image New Ayrton scene", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toContainText("new_uniform");
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.locator(".gallery-card")).toHaveCount(5);
});

test("character selection persists and Homebrew gallery includes global tag matches", async ({
  page,
}) => {
  await page.goto("#tools/characters");
  await page.getByRole("button", { name: "Load Character Sheet" }).click();
  await page.getByRole("button", { name: "Gallery", exact: true }).click();
  await page
    .getByLabel("Link character tag ayrton_octappen", { exact: true })
    .check();
  await expect(page.locator(".gallery-character-previews img")).toHaveCount(3);
  await page.getByLabel("Link character tag daria", { exact: true }).check();
  await expect(page.locator(".gallery-character-previews img")).toHaveCount(4);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("battleTrackerLocalCharacters")!)[0]
          .galleryCharacterTags,
    ),
  ).toEqual(["ayrton_octappen", "daria"]);
  await page.goto("#homebrew-gallery/gallery-character");
  await expect(
    page.getByRole("heading", { name: "Ayrton QA Images" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Old local portrait/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Ayrton uniform/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Daria portrait/ }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: /Ayrton uniform/ }),
  ).toBeVisible();
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem("eldritchGalleryV1")!);
    data.images.push({
      id: "future",
      userId: "guest",
      url: "https://i.imgur.com/future.png",
      label: "Future global upload",
      tags: ["ayrton_octappen"],
      createdAt: 100,
    });
    localStorage.setItem("eldritchGalleryV1", JSON.stringify(data));
    window.dispatchEvent(new Event("gallery-updated"));
  });
  await expect(
    page.getByRole("button", { name: /Future global upload/ }),
  ).toBeVisible();
  await page.goto("#tools/characters");
  await page.getByRole("button", { name: "Load Character Sheet" }).click();
  await page.getByRole("button", { name: "Gallery", exact: true }).click();
  await expect(
    page.getByLabel("Link character tag daria", { exact: true }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Clear selected tags (2)" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.goto("#homebrew-gallery/gallery-character");
  await expect(
    page.getByRole("button", { name: /Old local portrait/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Daria portrait/ }),
  ).toHaveCount(0);
});

test("administrators edit another uploader’s tags in the image side panel", async ({
  page,
}) => {
  await page.route("**/src/lib/auth.ts", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export const authProvider = { getUid: () => 'qa-admin', getDisplayName: () => 'Admin QA', onAuthChange: cb => { cb({uid:'qa-admin',email:null}); return () => {}; } };`,
    }),
  );
  await page.route("**/src/lib/firestore.ts", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `
    export * from './firestore.ts?galleryActual';
    import { subscribeGalleryReactions as localReactions } from './firestore.ts?galleryActual';
    export const subscribeGalleryReactions = (uid, ...callbacks) => localReactions('guest', ...callbacks);
    export const loadAdminAccess = async () => ({isAdmin:true,source:'qa'});
    export const pruneUnusedGalleryTags = async () => {
      const data = JSON.parse(localStorage.getItem('eldritchGalleryV1'));
      const used = new Set(data.images.flatMap(image => image.tags || []));
      const tags = data.tags.filter(tag => used.has(tag.name));
      if (tags.length !== data.tags.length) { data.tags = tags; localStorage.setItem('eldritchGalleryV1',JSON.stringify(data)); window.dispatchEvent(new Event('gallery-updated')); }
    };
    export const subscribePublicGalleryCharacters = cb => { cb([]); return () => {}; };
    export const subscribeGlobalGallery = (uid, onImages, onTags) => {
      const refresh = () => { const data = JSON.parse(localStorage.getItem('eldritchGalleryV1')); onImages(data.images); onTags(data.tags); };
      refresh(); window.addEventListener('gallery-updated', refresh);
      return () => window.removeEventListener('gallery-updated', refresh);
    };
    export const saveGalleryImageTags = async (uid, image, tags, definitions) => {
      if (uid !== 'qa-admin') throw new Error('Not authorized');
      const data = JSON.parse(localStorage.getItem('eldritchGalleryV1'));
      data.images = data.images.map(old => old.id === image.id ? {...old,tags} : old);
      data.tags = [...new Map([...data.tags,...definitions].map(tag => [tag.name,tag])).values()];
      localStorage.setItem('eldritchGalleryV1',JSON.stringify(data)); window.dispatchEvent(new Event('gallery-updated'));
    };
  `,
    }),
  );
  await page.goto("#tools/gallery");
  await page
    .getByRole("button", { name: "Open image Ayrton portrait", exact: true })
    .click();
  const panel = page.getByRole("complementary", { name: "Image tag editor" });
  await expect(panel).toBeVisible();
  await panel
    .getByRole("button", { name: "Remove tag armor", exact: true })
    .click();
  await panel
    .getByRole("combobox", {
      name: "Image tags: select or create tag",
      exact: true,
    })
    .fill("admin_added_tag");
  await panel.getByRole("button", { name: "Add tag", exact: true }).click();
  await panel
    .getByRole("button", { name: "Save image tags", exact: true })
    .click();
  await expect(panel.getByRole("status")).toHaveText("Tags saved.");
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("eldritchGalleryV1")!).images.find(
      (image: any) => image.id === "one",
    ),
  );
  expect(stored.userId).toBe("guest");
  expect(stored.tags).toEqual([
    "ayrton_octappen",
    "splash_art",
    "admin_added_tag",
  ]);
  await page.screenshot({
    path: ".artifacts/demo-game/gallery-admin-tags.png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await panel
    .getByRole("button", { name: "Save image tags", exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    panel.getByRole("button", { name: "Save image tags", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: ".artifacts/demo-game/gallery-admin-tags-mobile.png",
  });
  await page.reload();
  await page
    .getByRole("button", { name: "Open image Ayrton portrait", exact: true })
    .click();
  await expect(
    panel.getByRole("button", {
      name: "Remove tag admin_added_tag",
      exact: true,
    }),
  ).toBeVisible();
});

test("ordinary viewers cannot edit another uploader’s image tags", async ({
  page,
}) => {
  await page.goto("#tools/gallery");
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem("eldritchGalleryV1")!);
    data.images[0].userId = "another-user";
    localStorage.setItem("eldritchGalleryV1", JSON.stringify(data));
    window.dispatchEvent(new Event("gallery-updated"));
  });
  await page
    .getByRole("button", { name: "Open image Ayrton portrait", exact: true })
    .click();
  await expect(
    page.getByRole("complementary", { name: "Image tag editor" }),
  ).toHaveCount(0);
});

test("standalone Pixhost links and failed file uploads can be retried safely", async ({
  page,
}) => {
  await page.route("**/api/pixhost-image", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      url: "https://pixhost.to/show/1/2_standalone.png",
    });
    await route.fulfill({
      json: { url: "https://img3.pixhost.to/images/1/2_standalone.png" },
    });
  });
  let attempts = 0;
  await page.route("**/api/upload-pixhost-image", async (route) => {
    attempts++;
    if (attempts === 1)
      await route.fulfill({
        status: 502,
        json: { error: "Temporary upload failure" },
      });
    else
      await route.fulfill({
        json: {
          show_url: "https://pixhost.to/show/1/2_retry.png",
          th_url: "https://t3.pixhost.to/thumbs/1/2_retry.png",
        },
      });
  });
  await page.goto("#tools/gallery");
  await page
    .getByRole("button", { name: "Add images", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Imgur / Pixhost links or BBCode")
    .fill("https://pixhost.to/show/1/2_standalone.png");
  await dialog.getByRole("button", { name: "Preview links" }).click();
  await expect(dialog.locator(".gallery-draft")).toHaveCount(1);
  await dialog
    .getByLabel("Choose gallery image files")
    .setInputFiles(path.resolve("public/resources/races/wood-elf.png"));
  await expect(dialog.locator(".gallery-draft")).toHaveCount(2);
  await page.screenshot({
    path: ".artifacts/demo-game/gallery-upload-desktop.png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: ".artifacts/demo-game/gallery-upload-mobile.png",
  });
  await dialog
    .getByRole("button", { name: "Save to this browser", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Nothing has been published",
  );
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("eldritchGalleryV1")!).images.length,
    ),
  ).toBe(4);
  await dialog
    .getByRole("button", { name: "Save to this browser", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(attempts).toBe(2);
  await expect(page.locator(".gallery-card")).toHaveCount(6);
});

test("Imgur album and local file imports reuse existing API helpers", async ({
  page,
}) => {
  let uploadCalls = 0;
  await page.route("**/api/imgur-album", (route) =>
    route.fulfill({
      json: {
        data: [
          {
            link: "https://i.imgur.com/albumone.png",
            title: "Album image",
            type: "image/png",
          },
          { link: "https://i.imgur.com/albumtwo.png", type: "image/png" },
        ],
      },
    }),
  );
  await page.route("**/api/upload-pixhost-image", async (route) => {
    uploadCalls++;
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataBuffer()?.toString()).toContain(
      "optimize_for_web",
    );
    await route.fulfill({
      json: {
        show_url: "https://pixhost.to/show/1/2_uploaded.png",
        th_url: "https://t3.pixhost.to/thumbs/1/2_uploaded.png",
        name: "uploaded.png",
      },
    });
  });
  await page.goto("#tools/gallery");
  await page
    .getByRole("button", { name: "Add images", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Imgur album", { exact: true })
    .fill("https://imgur.com/a/qa");
  await dialog
    .getByRole("button", { name: "Import album", exact: true })
    .click();
  await expect(dialog.locator(".gallery-draft")).toHaveCount(2);
  await dialog
    .getByLabel("Choose gallery image files")
    .setInputFiles(path.resolve("public/resources/races/wood-elf.png"));
  await expect(dialog.locator(".gallery-draft")).toHaveCount(3);
  await dialog
    .getByRole("button", { name: "Save to this browser", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(uploadCalls).toBe(1);
  await expect(page.locator(".gallery-card")).toHaveCount(7);
});

test("tag library and desktop gallery visual check", async ({ page }) => {
  await page.goto("#tools/gallery");
  await page.getByRole("button", { name: "Tag library", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "ayrton_uniform", exact: true })
    .click();
  await dialog.getByLabel("Tag library category").selectOption("meta");
  await dialog.getByRole("button", { name: "Save tag", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText(
    "Saved ayrton_uniform",
  );
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Filter tag ayrton_uniform",
      exact: true,
    }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.screenshot({
    path: ".artifacts/demo-game/gallery-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: ".artifacts/demo-game/gallery-mobile.png",
    fullPage: true,
  });
});

test("linked global images use the original Main, Splash Art and Token selections", async ({
  page,
}) => {
  await page.goto("#tools/characters");
  await page.getByRole("button", { name: "Load Character Sheet" }).click();
  await page.getByRole("button", { name: "Gallery", exact: true }).click();
  await page
    .getByLabel("Link character tag ayrton_octappen", { exact: true })
    .check();
  const first = page.locator(".gallery-linked-role-card").filter({
    has: page.getByRole("button", {
      name: "Open linked image Ayrton portrait",
      exact: true,
    }),
  });
  const second = page.locator(".gallery-linked-role-card").filter({
    has: page.getByRole("button", {
      name: "Open linked image Ayrton uniform",
      exact: true,
    }),
  });
  await first.getByRole("button", { name: "Main", exact: true }).click();
  await first.getByRole("button", { name: "Splash Art", exact: true }).click();
  await second.getByRole("button", { name: "Token", exact: true }).click();
  await expect(
    first.getByRole("button", { name: "Main", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    first.getByRole("button", { name: "Splash Art", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.locator('img[src="https://i.imgur.com/one.png"]'),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const stored = await page.evaluate(() => ({
    character: JSON.parse(
      localStorage.getItem("battleTrackerLocalCharacters")!,
    )[0],
    global: JSON.parse(localStorage.getItem("eldritchGalleryV1")!),
  }));
  expect(
    stored.character.gallery.find(
      (image: any) => image.url === "https://i.imgur.com/one.png",
    ).tags,
  ).toEqual(["main", "splash-art"]);
  expect(stored.character.portraitUrl).toBe("https://i.imgur.com/one.png");
  expect(
    stored.character.gallery.find(
      (image: any) => image.url === "https://i.imgur.com/four.png",
    ).tags,
  ).toEqual(["token"]);
  expect(
    stored.global.images.find((image: any) => image.id === "one").tags,
  ).toEqual(["ayrton_octappen", "splash_art", "armor"]);
  await page.reload();
  await page.getByRole("button", { name: "Load Character Sheet" }).click();
  await page.getByRole("button", { name: "Gallery", exact: true }).click();
  await expect(
    first.getByRole("button", { name: "Splash Art", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await second.getByRole("button", { name: "Main", exact: true }).click();
  await expect(
    first.getByRole("button", { name: "Main", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await page.screenshot({
    path: ".artifacts/demo-game/gallery-linked-roles.png",
  });
});

test("unused tags disappear automatically after the last tag or image is removed", async ({
  page,
}) => {
  await page.goto("#tools/gallery");
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem("eldritchGalleryV1")!);
    data.tags.push({ name: "old_unused", category: "general" });
    localStorage.setItem("eldritchGalleryV1", JSON.stringify(data));
    window.dispatchEvent(new Event("gallery-updated"));
  });
  await expect(
    page.getByRole("button", { name: "Filter tag old_unused", exact: true }),
  ).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem("eldritchGalleryV1")!).tags.some(
          (tag: any) => tag.name === "old_unused",
        ),
      ),
    )
    .toBe(false);
  await page
    .getByRole("button", { name: "Open image Ayrton portrait", exact: true })
    .click();
  const panel = page.getByRole("complementary", { name: "Image tag editor" });
  await panel
    .getByRole("button", { name: "Remove tag armor", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "Save image tags", exact: true })
    .click();
  await expect(panel.getByRole("status")).toHaveText("Tags saved.");
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Filter tag armor", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Open image Daria portrait", exact: true })
    .click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Filter tag daria", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Filter tag splash_art", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Filter tag armor", exact: true }),
  ).toHaveCount(0);
});

test("character image editor autocompletes global tags and publishes private images while keeping specific tags local", async ({
  page,
}) => {
  await page.goto("#tools/characters");
  await page.getByRole("button", { name: "Load Character Sheet" }).click();
  await page.getByRole("button", { name: "Gallery", exact: true }).click();
  await page
    .getByRole("img", { name: "Old local portrait", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Image tags", exact: true });
  const shared = dialog.getByRole("combobox", {
    name: "Global tags: select or create tag",
    exact: true,
  });
  await shared.fill("ayrton_oct");
  await dialog
    .getByRole("option")
    .filter({ hasText: "ayrton_octappen" })
    .click();
  await shared.fill("character_added_tag");
  await dialog
    .getByLabel("Global tags: new tag category", { exact: true })
    .selectOption("meta");
  await dialog
    .locator("section")
    .first()
    .getByRole("button", { name: "Add tag", exact: true })
    .click();
  const local = dialog.getByRole("combobox", {
    name: "Character Specific tags: select or create tag",
    exact: true,
  });
  await local.fill("secret_story");
  await local.press("Enter");
  await page.screenshot({
    path: ".artifacts/demo-game/character-gallery-tags-desktop.png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: ".artifacts/demo-game/character-gallery-tags-mobile.png",
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Save tags", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const saved = await page.evaluate(() => ({
    global: JSON.parse(localStorage.getItem("eldritchGalleryV1")!),
    character: JSON.parse(
      localStorage.getItem("battleTrackerLocalCharacters")!,
    )[0],
  }));
  expect(
    saved.global.images.filter((image: any) =>
      image.url.includes("legacy.png"),
    ),
  ).toHaveLength(1);
  expect(
    saved.global.images.find((image: any) => image.url.includes("legacy.png"))
      .tags,
  ).toEqual(["ayrton_octappen", "character_added_tag"]);
  expect(saved.global.tags).toContainEqual({
    name: "character_added_tag",
    category: "meta",
  });
  expect(
    saved.global.tags.some((tag: any) => tag.name === "secret_story"),
  ).toBe(false);
  expect(saved.character.visibility).toBe("private");
  expect(saved.character.gallery[0].tags).toEqual([
    "main",
    "ayrton_octappen",
    "character_added_tag",
  ]);
  expect(saved.character.gallery[0].characterSpecificTags).toEqual([
    "secret_story",
  ]);
  await page.goto("#tools/gallery");
  await page
    .getByRole("combobox", { name: "Search gallery tags" })
    .fill("character_added_tag");
  await expect(page.locator(".gallery-card")).toHaveCount(1);
  await expect(page.locator(".gallery-card")).toContainText(
    "Old local portrait",
  );
  await page.reload();
  await page.goto("#tools/characters");
  await page.getByRole("button", { name: "Load Character Sheet" }).click();
  await page.getByRole("button", { name: "Gallery", exact: true }).click();
  await page.getByRole("button", { name: "Edit tags", exact: true }).click();
  await expect(
    dialog.getByRole("button", {
      name: "Remove tag secret_story",
      exact: true,
    }),
  ).toBeVisible();
  await shared.fill("armor");
  await dialog.getByRole("option").filter({ hasText: "armor" }).click();
  await dialog.getByRole("button", { name: "Save tags", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("eldritchGalleryV1")!).images.filter(
          (image: any) => image.url.includes("legacy.png"),
        ).length,
    ),
  ).toBe(1);
});

test("favorites combine with tag search, likes can be undone and rapid personal rockets persist", async ({
  page,
}) => {
  await page.goto("#tools/gallery");
  const card = page.locator(".gallery-card").filter({
    has: page.getByRole("heading", { name: "Ayrton portrait", exact: true }),
  });
  await card
    .getByRole("button", { name: "Favorite image", exact: true })
    .click();
  await expect(
    card.getByRole("button", { name: "Favorite image", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await card.getByRole("button", { name: "Like image", exact: true }).click();
  await expect(card.getByLabel("Total likes", { exact: true })).toHaveText("1");
  await card
    .getByRole("button", { name: "Rocket image", exact: true })
    .evaluate((button) => {
      for (let index = 0; index < 7; index++)
        (button as HTMLButtonElement).click();
    });
  await expect(
    card.getByLabel("Your rocket count", { exact: true }),
  ).toHaveText("7");
  await page
    .getByRole("button", { name: "Favorites only", exact: true })
    .click();
  await expect(page.locator(".gallery-card")).toHaveCount(1);
  const search = page.getByRole("combobox", {
    name: "Search gallery tags",
    exact: true,
  });
  await search.fill("ayrton_octappen -nsfw");
  await expect(page.locator(".gallery-card")).toHaveCount(1);
  await search.fill("nsfw");
  await expect(page.locator(".gallery-card")).toHaveCount(0);
  await search.fill("");
  await card
    .getByRole("button", { name: "Open image Ayrton portrait", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByLabel("Your rocket count", { exact: true }),
  ).toHaveText("7");
  await dialog.getByRole("button", { name: "Like image", exact: true }).click();
  await expect(dialog.getByLabel("Total likes", { exact: true })).toHaveText(
    "0",
  );
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(
    card.getByLabel("Your rocket count", { exact: true }),
  ).toHaveText("7");
  await expect(
    card.getByRole("button", { name: "Favorite image", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({
    path: ".artifacts/demo-game/gallery-reactions-desktop.png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: ".artifacts/demo-game/gallery-reactions-mobile.png",
  });
  await page
    .getByRole("button", { name: "Favorites only", exact: true })
    .click();
  await card
    .getByRole("button", { name: "Favorite image", exact: true })
    .click();
  await expect(page.locator(".gallery-card")).toHaveCount(0);
});

test("gallery pages contain 50 images and reset on a new search", async ({
  page,
}) => {
  await page.goto("#tools/gallery");
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem("eldritchGalleryV1")!);
    for (let index = 0; index < 106; index++)
      data.images.push({
        id: `page-${index}`,
        userId: "guest",
        label: `Pagination ${index}`,
        url: `https://i.imgur.com/page-${index}.png`,
        tags: index === 105 ? ["unique_page_tag"] : ["pagination"],
        createdAt: 1000 + index,
      });
    localStorage.setItem("eldritchGalleryV1", JSON.stringify(data));
    window.dispatchEvent(new Event("gallery-updated"));
  });
  await expect(page.locator(".gallery-card")).toHaveCount(50);
  await expect(page.getByRole("button", { name: /Load more/ })).toHaveCount(0);
  const pages = page.getByRole("navigation", {
    name: "Gallery pages",
    exact: true,
  });
  await pages.getByLabel("Gallery page", { exact: true }).selectOption("3");
  await expect(page.locator(".gallery-card")).toHaveCount(10);
  await expect(pages).toContainText("101–110 / 110");
  await pages
    .getByRole("button", { name: "Previous gallery page", exact: true })
    .click();
  await expect(page.locator(".gallery-card")).toHaveCount(50);
  await pages
    .getByRole("button", { name: "Next gallery page", exact: true })
    .click();
  await expect(page.locator(".gallery-card")).toHaveCount(10);
  await page
    .getByRole("combobox", { name: "Search gallery tags", exact: true })
    .fill("unique_page_tag");
  await expect(page.locator(".gallery-card")).toHaveCount(1);
  await expect(pages.getByLabel("Gallery page", { exact: true })).toHaveValue(
    "1",
  );
});

test("new global uploads announce the uploader and retry Discord without republishing", async ({
  page,
}) => {
  await page.route("**/src/lib/auth.ts", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export const authProvider = { getUid: () => 'publisher', getDisplayName: () => 'Publisher QA', onAuthChange: cb => { cb({uid:'publisher',displayName:'Publisher QA'}); return () => {}; } };`,
    }),
  );
  await page.route("**/src/lib/firestore.ts", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `
    export * from './firestore.ts?galleryActual';
    import * as actual from './firestore.ts?galleryActual';
    export const loadAdminAccess = async () => ({isAdmin:false});
    export const subscribePublicGalleryCharacters = cb => { cb([]); return () => {}; };
    export const subscribeGalleryReactions = (uid,...callbacks) => actual.subscribeGalleryReactions('guest',...callbacks);
    export const subscribeGlobalGallery = (uid,...callbacks) => actual.subscribeGlobalGallery('guest',...callbacks);
    export const saveGlobalGallery = async (uid,images,tags) => {
      localStorage.setItem('publishCalls',String(Number(localStorage.getItem('publishCalls') || '0')+1));
      const data = JSON.parse(localStorage.getItem('eldritchGalleryV1'));
      const map = new Map(data.images.map(image => [image.id,image])); images.forEach(image => map.set(image.id,image));
      data.images = [...map.values()]; data.tags = [...new Map([...data.tags,...tags].map(tag => [tag.name,tag])).values()];
      localStorage.setItem('eldritchGalleryV1',JSON.stringify(data)); window.dispatchEvent(new Event('gallery-updated'));
    };
  `,
    }),
  );
  const announcements: any[] = [];
  await page.route("**/api/announce-gallery-images", (route) => {
    announcements.push(route.request().postDataJSON());
    return route.fulfill({
      status: announcements.length === 1 ? 502 : 200,
      json:
        announcements.length === 1
          ? { error: "Discord temporarily unavailable", announcedImages: 0 }
          : { success: true, announcedImages: 2 },
    });
  });
  await page.goto("#tools/gallery");
  await page.getByRole("button", { name: "Add images", exact: true }).click();
  await page
    .getByLabel("Imgur / Pixhost links or BBCode", { exact: true })
    .fill(
      "https://i.imgur.com/announce-one.png\nhttps://i.imgur.com/announce-two.png",
    );
  await page
    .getByRole("button", { name: "Preview links", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Publish images", exact: true })
    .click();
  const published = page.getByRole("dialog", {
    name: "Images published",
    exact: true,
  });
  await expect(published.getByRole("alert")).toContainText("Images published");
  expect(announcements[0]).toMatchObject({
    scope: "global",
    userName: "Publisher QA",
    imageUrls: [
      "https://i.imgur.com/announce-one.png",
      "https://i.imgur.com/announce-two.png",
    ],
  });
  expect(announcements[0].galleryUrl).toContain("#tools/gallery");
  await published
    .getByRole("button", { name: "Retry Discord announcement", exact: true })
    .click();
  await expect(published).toHaveCount(0);
  expect(announcements).toHaveLength(2);
  expect(await page.evaluate(() => localStorage.getItem("publishCalls"))).toBe(
    "1",
  );
  await expect(page.locator(".gallery-card")).toHaveCount(6);
  // Editing a label is not a new upload and does not send another announcement.
  await page.locator(".gallery-card-image").first().click();
  await page
    .getByRole("button", { name: "Edit tags & label", exact: true })
    .click();
  await page
    .getByLabel("Image 1 label", { exact: true })
    .fill("Edited without announcement");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(announcements).toHaveLength(2);
});
