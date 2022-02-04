import { getContext, removeFromIndex } from '../../fullTextSearch';

import { logger } from '../../global';

export const removeFromIndexGeneralHandler = async (id: string) => {
  try {
    removeFromIndex(getContext(), { owner: id });
  } catch (e) {
    logger.error(e.message);
  }
};
