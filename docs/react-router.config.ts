import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { Config } from "@react-router/dev/config";
import { createGetUrl, getSlugs } from "fumadocs-core/source";

const getUrl = createGetUrl("/docs");
const docsDir = "content/docs";

async function* walkMdxFiles(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkMdxFiles(fullPath);
    } else if (entry.isFile() && entry.name.endsWith(".mdx")) {
      yield relative(docsDir, fullPath).split(sep).join("/");
    }
  }
}

export default {
  ssr: true,
  async prerender({ getStaticPaths }) {
    const paths: string[] = [];
    const excluded: string[] = ["/api/search"];

    for (const path of getStaticPaths()) {
      if (!excluded.includes(path)) paths.push(path);
    }

    for await (const entry of walkMdxFiles(docsDir)) {
      paths.push(getUrl(getSlugs(entry)));
    }

    return paths;
  },
} satisfies Config;
