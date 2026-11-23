import type { ProLayoutProps } from '@ant-design/pro-components';
import { token } from './theme';

/**
 * Pro layout defaults (docs/DESIGN-SYSTEM.md section 4): `mix` layout, fixed sidebar, light theme.
 * `colorPrimary` comes from `config/theme.ts`. Menu labels are localised from
 * `src/locales/en-US/menu.ts` (`layout.locale` in `config/config.ts`), so `locale` is not set here.
 */
const Settings: ProLayoutProps & {
  logo?: string;
} = {
  navTheme: 'light',
  colorPrimary: token.colorPrimary,
  layout: 'mix',
  contentWidth: 'Fluid',
  fixedHeader: false,
  fixSiderbar: true,
  colorWeak: false,
  title: 'Social Hub',
  logo: '/socialhub.svg',
  iconfontUrl: '',
  token: {},
};

export default Settings;
