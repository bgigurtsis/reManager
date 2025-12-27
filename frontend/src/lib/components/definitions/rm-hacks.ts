import { ComponentDefinition } from '../types'
import { CommandBuilders } from '../utils'

export const rmHacksComponent: ComponentDefinition = {
  id: 'rm-hacks',
  name: 'rM Hacks',
  description: 'Split screen, custom pen sizes, and more',
  version: '0.0.11-pre3',
  author: 'asivery',

  dependencies: ['xovi', 'qt-resource-rebuilder'],

  checkInstalled: () =>
    CommandBuilders.chain(
      CommandBuilders.testExists('/home/root/xovi/exthome/qt-resource-rebuilder/zz_rmhacks.qmd'),
      CommandBuilders.testExists('/home/root/xovi/exthome/qt-resource-rebuilder/rmhacks', 'directory')
    ),

  install: () => {
    const baseUrl = 'https://github.com/asivery/rm-hacks-qmd/archive/refs/heads/master.zip'

    return [
      CommandBuilders.changeDirectory('/home/root'),
      {
        script: `./curl -Lo rm-hacks.zip ${baseUrl}`,
        description: 'Download rM Hacks',
      },
      {
        script: 'unzip -o -d rm-hacks rm-hacks.zip "rm-hacks-qmd-master/0.0.11-pre3/*"',
        description: 'Extract rM Hacks',
      },
      {
        script: 'cp -r rm-hacks/rm-hacks-qmd-master/0.0.11-pre3/* /home/root/xovi/exthome/qt-resource-rebuilder/',
        description: 'Install rM Hacks to xovi',
      },
      {
        script: 'rm -rf rm-hacks rm-hacks.zip',
        description: 'Clean up temporary files',
      },
    ]
  },

  uninstall: () => [
    CommandBuilders.removeFile('/home/root/xovi/exthome/qt-resource-rebuilder/zz_rmhacks.qmd'),
    CommandBuilders.removeDirectory('/home/root/xovi/exthome/qt-resource-rebuilder/rmhacks'),
  ],

  category: 'enhancement',
  tags: ['ui', 'productivity'],
  requiresReboot: false,
}
