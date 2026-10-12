import type { Metadata } from "next";
import PlateDial from "@/components/art/PlateDial";
import { getAllArtProjects } from "@/lib/art-content";

export const metadata: Metadata = {
  title: "art — luckyzz.kr",
  description: "37.5665° N / 126.9780° E · plates",
};

export default function ArtPage() {
  const projects = getAllArtProjects();
  return <PlateDial projects={projects} />;
}
