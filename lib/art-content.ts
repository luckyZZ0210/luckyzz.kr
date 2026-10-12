import "server-only";
import fs from "fs";
import path from "path";
import matter from "gray-matter";
import type { ArtProject } from "./art";

const dir = path.join(process.cwd(), "content", "art");

export function getAllArtProjects(): ArtProject[] {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".mdx") || f.endsWith(".md"));
  const projects: ArtProject[] = files.map((f) => {
    const slug = f.replace(/\.(mdx|md)$/, "");
    const { data } = matter(fs.readFileSync(path.join(dir, f), "utf8"));
    return {
      slug,
      order: Number(data.order ?? 99),
      title: String(data.title ?? slug),
      ko: String(data.ko ?? ""),
      year: String(data.year ?? ""),
      material: String(data.material ?? ""),
      description: String(data.description ?? ""),
      images: Array.isArray(data.images) ? data.images.map(String) : [],
    };
  });
  return projects.sort((a, b) => a.order - b.order);
}
