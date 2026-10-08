// @ts-check
const { themes: prismThemes } = require('prism-react-renderer');

/**
 * One flag says which site this is (adr/0024):
 *
 *   officialserver=1  the copy that goes *inside* the tabversed binary: it is
 *                     served from the root of a server next to its /console,
 *                     so the base URL is "/", the canonical address is that
 *                     server's, and the navbar offers the console.
 *   (unset)           the GitHub Pages site at liyu1981.github.io/tabverse.
 *
 * `officialserver` is set by tools/embedsite.sh (the only thing that builds
 * this flavour) and cleared by tools/builddoc.sh (the only thing that builds
 * the Pages one), so one shell cannot produce a site for the wrong host.
 * @type {boolean}
 */
const official = process.env.officialserver === '1';

// TABVERSED_PUBLIC_URL is where the deployment is reached: an origin, the same
// value the server itself is configured with. It only decides the absolute
// URLs the docs emit (canonical, sitemap, og), never where the files live.
const officialUrl =
  (process.env.TABVERSED_PUBLIC_URL || 'https://tabversed.liyu1981.xyz').replace(
    /\/+$/,
    '',
  );

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'Tabverse',
  tagline: 'An Opinionated Way of Managing Tabs',
  url: official ? officialUrl : 'https://liyu1981.github.io/',
  baseUrl: official ? '/' : '/tabverse/',
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
          // The console of the server this copy of the site is served from,
          // right after the manual (adr/0024).
          //
          // Two things keep this an ordinary link instead of a navigation the
          // site performs itself: `pathname://` tells Docusaurus the target is
          // not one of *its* routes - following it client side would render the
          // site's own 404 - and `target: '_self'` undoes the new tab a link
          // carrying a protocol would otherwise get. What comes out is
          // `<a href="/console/" target="_self">`, a full page load of the
          // console, trailing slash and all.
          ...(official
            ? [
                {
                  label: 'Login',
                  to: 'pathname:///console/',
                  target: '_self',
                },
              ]
            : []),
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