import * as migration_20261030_133707_initial from './20261030_133707_initial'
import * as migration_20261030_144237_mcp_api_keys from './20261030_144237_mcp_api_keys'
import * as migration_20261030_153303_pages from './20261030_153303_pages'
import * as migration_20261030_153857_header_footer from './20261030_153857_header_footer'

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
]
