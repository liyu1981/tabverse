import HomepageFeatures from '../components/HomepageFeatures';
import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';
import React from 'react';
import { TabSpaceLogo } from '../components/TabSpaceLogo';
import clsx from 'clsx';
import styles from './index.module.css';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

function HomepageHeader() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <header className={clsx('hero hero--primary', styles.heroBanner)}>
      <div
        className={styles.tabverseScreenshotOutContainer}
        style={{ zIndex: 1 }}
      >
        <div className={clsx('container', styles.tabverseScreenshotContainer)}>
          <div className={styles.tabverseScreenshot}></div>
        </div>
      </div>
      <div className="container" style={{ zIndex: 2 }}>
        <div className={styles.tabverseLogo}>
          <TabSpaceLogo />
        </div>
        <div>
          <p className={clsx('hero__subtitle', styles.tabverseSlug)}>
            {siteConfig.tagline}
          </p>
          <div className={styles.buttons}>
            <Link
              className={clsx(
                'button button--secondary button--lg',
                styles.tabverseButton,
              )}
              href="https://chromewebstore.google.com/detail/tabverse/lffblcippngalmglinedcbmikkncihdm"
            >
              Install from Chrome Web Store
            </Link>
            <Link
              className={clsx(
                'button button--secondary button--lg',
                styles.tabverseButton,
              )}
              to="/docs/install-from-source"
            >
              Install from Source
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}

export default function Home() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout
      title={`${siteConfig.title}`}
      description="Description will go into a meta tag in <head />"
    >
      <HomepageHeader />
      <main>
        <HomepageFeatures />
      </main>
    </Layout>
  );
}
