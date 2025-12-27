import { ComponentDefinition } from '../types'
import { CommandBuilders, ArchUtils } from '../utils'

export const apploadComponent: ComponentDefinition = {
  id: 'appload',
  name: 'AppLoad',
  description: 'Run third-party apps like KOReader',
  version: 'v0.4.1',
  author: 'asivery',

  dependencies: ['xovi', 'qt-resource-rebuilder'],

  checkInstalled: () =>
    CommandBuilders.testExists('/home/root/xovi/extensions.d/appload.so'),

  install: (ctx) => {
    const arch = ArchUtils.getDownloadArch(ctx.arch)
    const baseUrl = `https://github.com/asivery/rm-appload/releases/download/v0.4.1/appload-${arch}.zip`

    return [
      CommandBuilders.changeDirectory('/home/root'),
      {
        script: `./curl -Lo appload.zip ${baseUrl}`,
        description: 'Download AppLoad',
      },
      {
        script: 'unzip -o -d /home/root/shims appload.zip && rm appload.zip',
        description: 'Extract AppLoad to shims',
      },
      {
        script: 'mv /home/root/shims/appload.so /home/root/xovi/extensions.d/appload.so',
        description: 'Move AppLoad extension',
      },
    ]
  },

  uninstall: () =>
    CommandBuilders.removeFile('/home/root/xovi/extensions.d/appload.so'),

  category: 'enhancement',
  tags: ['apps', 'third-party'],
  requiresReboot: false,
}
