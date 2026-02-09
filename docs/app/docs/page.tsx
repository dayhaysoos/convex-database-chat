import type { Route } from './+types/page';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import { source } from '@/lib/source';
import defaultMdxComponents from 'fumadocs-ui/mdx';
import browserCollections from 'fumadocs-mdx:collections/browser';
import { baseOptions } from '@/lib/layout.shared';
import { useFumadocsLoader } from 'fumadocs-core/source/client';

export async function loader({ params }: Route.LoaderArgs) {
  const raw = params['*'] ?? '';
  const slugs = raw.split('/').filter((v) => v.length > 0);
  const page = source.getPage(slugs);
  if (!page) throw new Response('Not found', { status: 404 });
  const title = page.data?.title;
  const description = page.data?.description;

  return {
    path: page.path,
    pageTree: await source.serializePageTree(source.getPageTree()),
    frontmatter: {
      title,
      description,
    },
  };
}

export function meta({ data }: Route.MetaArgs) {
  const title = data?.frontmatter?.title;
  const description = data?.frontmatter?.description;
  const tags = [] as ReturnType<Route.MetaFunction>;

  if (title) {
    tags.push({ title });
  }

  if (description) {
    tags.push({ name: 'description', content: description });
  }

  return tags;
}

const clientLoader = browserCollections.docs.createClientLoader({
  component(
    { toc, frontmatter, default: Mdx },
    // you can define props for the `<Content />` component
    props?: {
      className?: string;
    },
  ) {
    return (
      <DocsPage toc={toc} {...props}>
        <DocsTitle>{frontmatter.title}</DocsTitle>
        <DocsDescription>{frontmatter.description}</DocsDescription>
        <DocsBody>
          <Mdx components={{ ...defaultMdxComponents }} />
        </DocsBody>
      </DocsPage>
    );
  },
});

export default function Page({ loaderData }: Route.ComponentProps) {
  const { path, pageTree } = useFumadocsLoader(loaderData);

  return (
    <DocsLayout {...baseOptions()} tree={pageTree}>
      {clientLoader.useContent(path)}
    </DocsLayout>
  );
}
