import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PlateDial from "@/components/art/PlateDial";
import { getAllArtProjects } from "@/lib/art-content";

export function generateStaticParams() {
  return getAllArtProjects().map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const project = getAllArtProjects().find((p) => p.slug === slug);
  if (!project) return { title: "art — luckyzz.kr" };
  return {
    title: `${project.title} — luckyzz.kr`,
    description: `${project.ko} · ${project.year} · ${project.material}`,
  };
}

export default async function ArtProjectPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const projects = getAllArtProjects();
  if (!projects.find((p) => p.slug === slug)) notFound();
  return <PlateDial projects={projects} initialSlug={slug} />;
}
