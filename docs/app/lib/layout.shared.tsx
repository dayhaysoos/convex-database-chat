import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export function baseOptions(): BaseLayoutProps {
  return {
    themeSwitch: {
      enabled: false,
    },
    githubUrl: 'https://github.com/dayhaysoos/convex-database-chat',
    links: [
      { text: 'Docs', url: '/docs', active: 'nested-url' },
      {
        text: 'Live Example',
        url: 'https://convex-database-chat-production.up.railway.app/',
        external: true,
      },
    ],
    nav: {
      title: 'DatabaseChat',
      url: '/docs',
    },
  };
}
