// @ts-check
const { themes: prismThemes } = require('prism-react-renderer');

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'Tabverse',
  tagline: 'An Opinionated Way of Managing Tabs',
  url: 'https://liyu1981.github.io/',
  baseUrl: '/tabverse/',
  onBrokenLinks: 'throw',
  // Paths are resolved against the static directory, and get the baseUrl
  // prefixed automatically, both in dev and in the production build.
  favicon: 'img/icon19.png',
  organizationName: 'liyu1981',
  projectName: 'tabverse',

  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  presets: [
    [
      '@docusaurus/preset-classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: require.resolve('./sidebars.js'),
          // Please change this to your repo.
          editUrl:
            'https://github.com/liyu1981/tabverse/edit/main/doc/tabverse-website/',
        },
        blog: {
          showReadingTime: true,
          // Please change this to your repo.
          editUrl:
            'https://github.com/liyu1981/tabverse/edit/main/doc/tabverse-website/',
        },
        theme: {
          customCss: require.resolve('./src/css/custom.css'),
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      navbar: {
        title: 'Tabverse',
        logo: {
          alt: 'Tabverse Logo',
          src: 'img/icon48.png',
        },
        items: [
          {
            label: 'User Manual',
            to: '/docs/intro',
          },
          {
            href: 'https://github.com/liyu1981/tabverse',
            label: 'GitHub',
            className: 'tabverse-github-header',
            position: 'right',
          },
        ],
      },
      footer: {
        style: 'light',
        links: [
          {
            title: 'Tabverse',
            items: [
              {
                label: 'Open Source',
                href: 'https://github.com/liyu1981/tabverse',
              },
              {
                label: 'Feedback & Issue',
                href: 'https://github.com/liyu1981/tabverse/discussions',
              },
            ],
          },
          {
            title: 'Community',
            items: [
              {
                label: 'Privacy Policy',
                to: '/privacy',
              },
            ],
          },
          {
            title: 'More',
            items: [
              {
                label: 'User Manual',
                to: '/docs/intro',
              },
            ],
          },
        ],
        copyright: `Copyright © ${new Date().getFullYear()} Tabverse Project. This website is built with Docusaurus.`,
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
      },
    }),
};

module.exports = config;