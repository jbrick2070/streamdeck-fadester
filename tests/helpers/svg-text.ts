// SPDX-License-Identifier: GPL-2.0-or-later

/**
 * The SVG a picture URI carries. A key's picture is URL-encoded; a dial's strip picture is base64 (OpenDeck's strip
 * renderer reads only that form). A string that is not a data URI is the SVG itself.
 */
export function decodeSvgUri(uri: string): string {
  const comma = uri.indexOf(",");
  if (!uri.startsWith("data:") || comma < 0) return uri;
  const body = uri.slice(comma + 1);
  return uri.slice(0, comma).includes(";base64") ? Buffer.from(body, "base64").toString("utf8") : decodeURIComponent(body);
}

/** The words an SVG draws, with wrapped lines joined by a space and entities decoded. */
export function svgText(svg: string): string {
  return decodeSvgUri(svg)
    .replace(/<title>[\s\S]*?<\/title>/g, "")
    .replace(/<tspan[^>]*\bdy="[^"]*"[^>]*>/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}
