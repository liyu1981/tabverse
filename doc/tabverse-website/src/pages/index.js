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
            <span
              className={clsx(
                'button button--secondary button--lg',
                styles.tabverseButton,
                styles.tabverseButtonDisabled,
              )}
              aria-disabled="true"
              title="The Chrome Web Store listing is still under review"
            >
              Chrome Web Store · Coming soon
            </span>
            <Link
              className={clsx(
                'button button--secondary button--lg',
                styles.tabverseButton,
              )}
              href="https://github.com/liyu1981/tabverse/releases"
            >
              Download from Github (.zip)
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
