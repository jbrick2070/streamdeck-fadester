// SPDX-License-Identifier: GPL-2.0-or-later

/** The words an SVG draws, with wrapped lines joined by a space and entities decoded. */
export function svgText(svg: string): string {
  const prefix = "data:image/svg+xml;utf8,";
  return (svg.startsWith(prefix) ? decodeURIComponent(svg.slice(prefix.length)) : svg)
    .replace(/<title>[\s\S]*?<\/title>/g, "")
    .replace(/<tspan[^>]*\bdy="[^"]*"[^>]*>/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}
