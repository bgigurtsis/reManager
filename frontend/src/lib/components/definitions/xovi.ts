import { ComponentDefinition } from '../types'
import { CommandBuilders, ArchUtils } from '../utils'

export const xoviComponent: ComponentDefinition = {
  id: 'xovi',
  name: 'Xovi',
  description: 'Base framework for reMarkable modifications',
  version: 'v16-14112025',
  author: 'asivery',

  dependencies: [],

  checkInstalled: () => CommandBuilders.testExists('/home/root/xovi', 'directory'),

  install: (ctx) => {
    const archTesting = ArchUtils.getArchiveArch(ctx.arch)
    const baseUrl = 'https://github.com/asivery/rm-xovi-extensions/releases/download/v16-14112025'

    return [
      CommandBuilders.changeDirectory('/home/root'),
      CommandBuilders.conditional(
        'test -f curl',
        'echo "curl already exists"',
        'wget -q https://github.com/moparisern/remarkable-curl/releases/download/v0.1/curl-reMarkable2 -O curl && chmod +x curl'
      ),
      {
        script: `./curl -Lo extensions.zip ${baseUrl}/extensions-${archTesting}.zip`,
        description: 'Download xovi extensions',
      },
      {
        script: 'unzip -o -d extensions extensions.zip && rm extensions.zip',
        description: 'Extract extensions',
      },
      {
        script: 'bash extensions/install-xovi-for-rm',
        description: 'Run xovi installer',
      },
    ]
  },

  preUninstall: {
    type: 'custom',
    execute: async () => ({
      command: {
        script: '/home/root/xovi/stock',
        description: 'Restore device to stock state',
      },
    }),
  },

  uninstall: () => [
    CommandBuilders.removeDirectory('/home/root/xovi'),
    CommandBuilders.removeDirectory('/home/root/extensions'),
  ],

  enable: () => ({
    script: '/home/root/xovi/start',
    description: 'Start xovi',
  }),

  disable: () => ({
    script: '/home/root/xovi/stop',
    description: 'Stop xovi',
  }),

  maintenanceCommands: [
    {
      id: 'start',
      label: 'Start Xovi',
      description: 'Start the xovi framework',
      command: () => ({ script: '/home/root/xovi/start', description: 'Start xovi' }),
    },
    {
      id: 'debug',
      label: 'Debug Mode',
      description: 'Run xovi in debug mode with live output',
      command: () => ({ script: '/home/root/xovi/debug', description: 'Run xovi debug' }),
      requiresTerminal: true,
      allowStop: true,
    },
    {
      id: 'stock',
      label: 'Restore Stock',
      description: 'Restore device to stock remarkable software',
      command: () => ({ script: '/home/root/xovi/stock', description: 'Restore stock' }),
      requiresTerminal: true,
    },
  ],

  category: 'core',
  tags: ['framework', 'required'],
  requiresReboot: false,
}
