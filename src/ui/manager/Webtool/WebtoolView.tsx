import { t } from '../../../i18n';
import React from 'react';
import classes from './WebtoolView.module.scss';

export function WebtoolView(_props) {
  // const [currentQuery, setCurrentQuery] = useState<Query>(EmptyQuery);

  // To fix: this is the current simple and  stupid solution, just point to
  // my github page for tools

  return (
    <iframe
      className={classes.iframeContainer}
      title={t('webtoolTitle')}
      src="https://liyu1981.github.io/my-awesome-web-tool-gallery/"
    ></iframe>
    // <SimpleBar style={{ height: '100vh' }}>
    //   <div className={classes.container}>
    //     <div className={classes.stickyOn}>
    //       <div className={classes.searchBar}>
    //         <div className={classes.searchInputContainer}>
    //           <SearchInput query={currentQuery} onChange={setCurrentQuery} />
    //         </div>
    //       </div>
    //     </div>
    //   </div>
    // </SimpleBar>
  );
}
