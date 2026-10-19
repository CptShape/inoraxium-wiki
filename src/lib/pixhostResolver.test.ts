import { describe, expect, it } from "vitest";
import {
  extractPixhostImage,
  parsePixhostShowUrl,
} from "../../api/pixhost-image";

describe("Pixhost page resolver boundary", () => {
  it("accepts only direct HTTPS Pixhost show-page requests", () => {
    expect(
      parsePixhostShowUrl("https://pixhost.to/show/12/34_art.png")?.hostname,
    ).toBe("pixhost.to");
    for (const value of [
      "http://pixhost.to/show/1/a.png",
      "https://pixhost.to.evil.test/show/1/a.png",
      "https://127.0.0.1/show/1/a.png",
      "https://user:pass@pixhost.to/show/1/a.png",
      "https://pixhost.to:8080/show/1/a.png",
      "https://pixhost.to/images/1/a.png",
      "//pixhost.to/show/1/a.png",
    ])
      expect(parsePixhostShowUrl(value)).toBeNull();
  });
  it("extracts only full images from the Pixhost image CDN", () => {
    expect(
      extractPixhostImage(
        '<img src="https://t3.pixhost.to/thumbs/1/2_art.png"><img id="image" src="https://img3.pixhost.to/images/1/2_art.png">',
      ),
    ).toBe("https://img3.pixhost.to/images/1/2_art.png");
    expect(
      extractPixhostImage('<img src="https://evil.test/images/1/a.png">'),
    ).toBeNull();
    expect(
      extractPixhostImage(
        "<script>https://img3.pixhost.to.evil.test/images/1/a.png</script>",
      ),
    ).toBeNull();
  });
});
