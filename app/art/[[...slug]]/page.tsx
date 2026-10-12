import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PlateDial from "@/components/art/PlateDial";
import { getAllArtProjects } from "@/lib/art-content";

// One route for /art and /art/[slug] so PlateDial stays mounted while the URL
// changes via history.pushState (open) / history.back (close).
export const dynamicParams = false;

export function generateStaticParams() {
  return [{ slug: [] }, ...getAllArtProjects().map((p) => ({ slug: [p.slug] }))];
}

type Params = { params: Promise<{ slug?: string[] }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const project = slug?.[0] ? getAllArtProjects().find((p) => p.slug === slug[0]) : undefined;
  if (!project) {
    return { title: "art — luckyzz.kr", description: "37.5665° N / 126.9780° E · plates" };
  }
  return {
    title: `${project.title} — luckyzz.kr`,
    description: `${project.ko} · ${project.year} · ${project.material}`,
  };
}

export default async function ArtPage({ params }: Params) {
  const { slug } = await params;
  if (slug && slug.length > 1) notFound();
  const projects = getAllArtProjects();
  const initialSlug = slug?.[0];
  if (initialSlug && !projects.some((p) => p.slug === initialSlug)) notFound();
  return <PlateDial projects={projects} initialSlug={initialSlug} />;
}
