import menu from './en-US/menu';
import network from './en-US/network';
import pages from './en-US/pages';
import settingDrawer from './en-US/settingDrawer';

/** The only maintained panel locale. `fa-IR` is kept untouched as the seam for a later Persian panel. */
export default {
  ...menu,
  ...settingDrawer,
  ...network,
  ...pages,
};
