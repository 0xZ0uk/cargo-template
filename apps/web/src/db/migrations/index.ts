import * as migration_20261030_133707_initial from './20261030_133707_initial';
import * as migration_20261030_144237_mcp_api_keys from './20261030_144237_mcp_api_keys';
import * as migration_20261030_153303_pages from './20261030_153303_pages';
import * as migration_20261030_153857_header_footer from './20261030_153857_header_footer';
import * as migration_20261103_110003_seo_analyzer from './20261103_110003_seo_analyzer';
import * as migration_20261103_162036_seo_breadcrumb_home_label from './20261103_162036_seo_breadcrumb_home_label';

export const migrations = [
  {
    up: migration_20261030_133707_initial.up,
    down: migration_20261030_133707_initial.down,
    name: '20261030_133707_initial',
  },
  {
    up: migration_20261030_144237_mcp_api_keys.up,
    down: migration_20261030_144237_mcp_api_keys.down,
    name: '20261030_144237_mcp_api_keys',
  },
  {
    up: migration_20261030_153303_pages.up,
    down: migration_20261030_153303_pages.down,
    name: '20261030_153303_pages',
  },
  {
    up: migration_20261030_153857_header_footer.up,
    down: migration_20261030_153857_header_footer.down,
    name: '20261030_153857_header_footer',
  },
  {
    up: migration_20261103_110003_seo_analyzer.up,
    down: migration_20261103_110003_seo_analyzer.down,
    name: '20261103_110003_seo_analyzer',
  },
  {
    up: migration_20261103_162036_seo_breadcrumb_home_label.up,
    down: migration_20261103_162036_seo_breadcrumb_home_label.down,
    name: '20261103_162036_seo_breadcrumb_home_label'
  },
];
