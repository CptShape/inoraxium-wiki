import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyApiCors } from "./_lib/http.js";

export const parsePixhostShowUrl = (raw: unknown): URL | null => {
  if (typeof raw !== "string" || raw.length > 4096) return null;
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      !/^(www\.)?pixhost\.to$/i.test(url.hostname) ||
      url.username ||
      url.password ||
      url.port ||
      !/^\/show\/\d+\/[^/]+$/i.test(url.pathname)
    )
      return null;
    url.search = "";
    url.hash = "";
    return url;
  } catch {
    return null;
  }
};
export const extractPixhostImage = (html: string): string | null => {
  const decoded = html.replace(/&amp;/g, "&").replace(/\\\//g, "/");
  return (
    decoded.match(
      /https:\/\/img\d+\.pixhost\.to\/images\/[^\s"'<>]+?\.(?:png|jpe?g|webp|gif|avif)(?:\?[^\s"'<>]*)?/i,
    )?.[0] || null
  );
};
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyApiCors(req, res, "POST, OPTIONS"))
    return res.status(403).json({ error: "Request origin is not allowed." });
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Use POST." });
  const url = parsePixhostShowUrl(req.body?.url);
  if (!url)
    return res
      .status(400)
      .json({ error: "Provide an HTTPS Pixhost /show/ image link." });
  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
      headers: { Accept: "text/html" },
    });
    if (!response.ok)
      return res
        .status(502)
        .json({
          error:
            "Pixhost image page could not be read. Paste the full BBCode including its thumbnail instead.",
        });
    const html = await response.text();
    if (html.length > 2_000_000)
      return res
        .status(502)
        .json({
          error: "Pixhost page was unexpectedly large. Use its BBCode instead.",
        });
    const image = extractPixhostImage(html);
    if (!image)
      return res
        .status(404)
        .json({
          error:
            "No full image was found. Paste the full Pixhost BBCode instead.",
        });
    return res.status(200).json({ url: image, thumbUrl: image });
  } catch {
    return res
      .status(502)
      .json({
        error: "Pixhost could not be reached. Retry or use its full BBCode.",
      });
  }
}
