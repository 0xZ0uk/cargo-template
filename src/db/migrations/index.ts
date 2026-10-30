import * as migration_20261030_133707_initial from './20261030_133707_initial'
import * as migration_20261030_144237_mcp_api_keys from './20261030_144237_mcp_api_keys'

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
]
