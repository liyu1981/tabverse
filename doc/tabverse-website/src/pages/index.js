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
        <div style={{ zoom: '2' }}>
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
              to="https://chrome.google.com/webstore/detail/tabverse/eingdgbkonkpnnjgmpgoemeoocjoalcm?hl=en"
            >
              Install from Chrome Web Store
            </Link>
            <Link
              className={clsx(
                'button button--secondary button--lg',
                styles.tabverseButton,
              )}
              href="https://github.com/liyu1981/tabverse/releases"
            >
              Download from Github(.crx)
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
