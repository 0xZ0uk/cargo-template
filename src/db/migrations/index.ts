import * as migration_20261030_133707_initial from './20261030_133707_initial'

export const migrations = [
  {
    up: migration_20261030_133707_initial.up,
    down: migration_20261030_133707_initial.down,
    name: '20261030_133707_initial',
  },
]
