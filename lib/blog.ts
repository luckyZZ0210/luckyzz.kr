import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { remark } from 'remark';
import html from 'remark-html';
import gfm from 'remark-gfm';

const contentDirectory = path.join(process.cwd(), 'content');

export interface Post {
  slug: string;
  title: string;
  date: string;
  excerpt?: string;
  tags?: string[];
  category?: string | null;
  content?: string;
}

export interface Work {
  slug: string;
  title: string;
  date: string;
  description?: string;
  tags?: string[];
  image?: string;
  link?: string;
  content?: string;
}

// Get all posts sorted by date
export function getAllPosts(): Post[] {
  const postsDirectory = path.join(contentDirectory, 'blog');

  if (!fs.existsSync(postsDirectory)) {
    return [];
  }

  const fileNames = fs.readdirSync(postsDirectory);
  const allPosts = fileNames
    .filter((fileName) => fileName.endsWith('.md'))
    .map((fileName) => {
      const slug = fileName.replace(/\.md$/, '');
      const fullPath = path.join(postsDirectory, fileName);
      const fileContents = fs.readFileSync(fullPath, 'utf8');
      const { data } = matter(fileContents);

      return {
        slug,
        title: data.title || slug,
        date: data.date || '',
        excerpt: data.excerpt || '',
        tags: data.tags || [],
        category: data.category || null,
      };
    });

  return allPosts.sort((a, b) => (a.date > b.date ? -1 : 1));
}

// Get a single post by slug
export async function getPostBySlug(slug: string): Promise<Post | null> {
  const postsDirectory = path.join(contentDirectory, 'blog');
  const fullPath = path.join(postsDirectory, `${slug}.md`);

  if (!fs.existsSync(fullPath)) {
    return null;
  }

  const fileContents = fs.readFileSync(fullPath, 'utf8');
  const { data, content } = matter(fileContents);

  const processedContent = await remark()
    .use(gfm)
    .use(html, { sanitize: false })
    .process(content);

  const contentHtml = processedContent.toString();

  return {
    slug,
    title: data.title || slug,
    date: data.date || '',
    excerpt: data.excerpt || '',
    tags: data.tags || [],
    content: contentHtml,
  };
}

// Get all works
export function getAllWorks(): Work[] {
  const worksDirectory = path.join(contentDirectory, 'works');

  if (!fs.existsSync(worksDirectory)) {
    return [];
  }

  const fileNames = fs.readdirSync(worksDirectory);
  const allWorks = fileNames
    .filter((fileName) => fileName.endsWith('.md'))
    .map((fileName) => {
      const slug = fileName.replace(/\.md$/, '');
      const fullPath = path.join(worksDirectory, fileName);
      const fileContents = fs.readFileSync(fullPath, 'utf8');
      const { data } = matter(fileContents);

      return {
        slug,
        title: data.title || slug,
        date: data.date || '',
        description: data.description || '',
        tags: data.tags || [],
        image: data.image || '',
        link: data.link || '',
      };
    });

  return allWorks.sort((a, b) => (a.date > b.date ? -1 : 1));
}

// Get a single work by slug
export async function getWorkBySlug(slug: string): Promise<Work | null> {
  const worksDirectory = path.join(contentDirectory, 'works');
  const fullPath = path.join(worksDirectory, `${slug}.md`);

  if (!fs.existsSync(fullPath)) {
    return null;
  }

  const fileContents = fs.readFileSync(fullPath, 'utf8');
  const { data, content } = matter(fileContents);

  const processedContent = await remark()
    .use(gfm)
    .use(html, { sanitize: false })
    .process(content);

  const contentHtml = processedContent.toString();

  return {
    slug,
    title: data.title || slug,
    date: data.date || '',
    description: data.description || '',
    tags: data.tags || [],
    image: data.image || '',
    link: data.link || '',
    content: contentHtml,
  };
}
