import React from 'react';
import clsx from 'clsx';
import styles from './HomepageFeatures.module.css';

const FeatureList = [
  {
    title: 'With Tabverse you can bravely closing that many tabs!',
    img: 'img/so-many-tabs-problem.png',
    description: (
      <>
        Tabverse helps you to best managing many chrome tabs opened for doing a
        project.
      </>
    ),
  },
  {
    title: 'Group your tabs and manage them with Tabverse',
    img: 'img/tabverse-feature-1.png',
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
    img: 'img/tabverse-feature-2.png',
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
    img: 'img/tabverse-feature-3.png',
    description: (
      <>
        Tabverse saves all your data inside your local Chrome storage. You do
        not need an account to enjoy it!
      </>
    ),
  },
  {
    title: 'Free and open source!',
    img: 'img/tabverse-feature-4.png',
    description: (
      <>
        You can use it free by installing from Chrome web store. We also open
        the source code through our github repo. Not satisfy on something?
        Contribute it or, fork it!
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
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} idx={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
