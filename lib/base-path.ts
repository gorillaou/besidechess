/** Prefix for files in `public/` when the site is served from a project path on GitHub Pages. */
export function asset(path: string): string {
  const base = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalized}`;
}

export const hostedWithoutServer = process.env.NEXT_PUBLIC_STATIC === "true";
