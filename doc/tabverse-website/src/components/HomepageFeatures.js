import React from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';
import clsx from 'clsx';
import styles from './HomepageFeatures.module.css';

const getFeatureList = (baseUrl) => [
  {
    title: 'With Tabverse you can bravely closing that many tabs!',
    img: `${baseUrl}img/so-many-tabs-problem.png`,
    description: (
      <>
        Tabverse helps you to best managing many chrome tabs opened for doing a
        project.
      </>
    ),
  },
  {
    title: 'Group your tabs and manage them with Tabverse',
    img: `${baseUrl}img/tabverse-feature-1.png`,
    description: (
      <>
        Group your tabs in one window and create Tabverse to manage them. One
        window, one Tabverse, and one workspace, focusing on one topic you are
        working.
      </>
    ),
  },
  {
    title:
      'You focus on working and let Tabverse focus on remembering your workspace',
    img: `${baseUrl}img/tabverse-feature-2.png`,
    description: (
      <>
        Save your Tabverse, and it will remember your tabs, todos, notes, and
        bookmarks automatically. Finishing your job? Feel free to close them as
        it is easy for find back with Tabverse.
      </>
    ),
  },
  {
    title:
      'You are master of your data. No login, no subscription, just convenience.',
    img: `${baseUrl}img/tabverse-feature-3.png`,
    description: (
      <>
        Tabverse saves all your data inside your local Chrome storage. You do
        not need an account to enjoy it, and pairing with your own sync server
        is optional.
      </>
    ),
  },
  {
    title: 'Your tabverses, on every browser you use',
    img: `${baseUrl}img/feature-placeholder.svg`,
    description: (
      <>
        Pair Tabverse with a sync server and your tabverses, notes, todos and
        bookmarks follow you between browsers. Run your own server, or use the
        official one - it is your choice.
      </>
    ),
  },
  {
    title: 'Notes, todos, bookmarks and history, right beside your tabs',
    img: `${baseUrl}img/feature-placeholder.svg`,
    description: (
      <>
        Every tabverse keeps its own notes, todos, bookmarks and history of
        closed tabs, in the same place as the tabs they belong to. No second
        app to open, no copy to paste.
      </>
    ),
  },
  {
    title: 'On-device AI that never leaves your browser',
    img: `${baseUrl}img/feature-placeholder.svg`,
    description: (
      <>
        Where Chrome already ships its built-in model, Tabverse can summarize a
        tab into a note or suggest a name for a tab collection. It runs entirely
        on your own machine - nothing is sent anywhere.
      </>
    ),
  },
  {
    title: 'Free and open source!',
    img: `${baseUrl}img/tabverse-feature-4.png`,
    description: (
      <>
        You can use it free. We also open the source code through our github
        repo. Not satisfied with something? Contribute it, or fork it!
      </>
    ),
  },
];

function Feature({ idx, img, svg, title, description }) {
  const picture = (
    <div className="text--left">
      {img ? <img src={img} className={styles.featureImg} alt={title} /> : ''}
      {svg ? <svg className={styles.featureSvg} alt={title} /> : ''}
    </div>
  );
  const text = (
    <div className={clsx('text--center padding-horiz--md', styles.featureText)}>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );

  return (
    <div className={clsx('col col--12', styles.featureContainer)}>
      {idx % 2 === 0 ? (
        <>
          {text}
          {picture}
        </>
      ) : (
        <>
          {picture}
          {text}
        </>
      )}
    </div>
  );
}

export default function HomepageFeatures() {
  const baseUrl = useBaseUrl('/');
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {getFeatureList(baseUrl).map((props, idx) => (
            <Feature key={idx} idx={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
