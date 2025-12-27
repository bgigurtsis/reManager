import { ComponentDefinition } from '../types'
import { CommandBuilders } from '../utils'

export const tripletapComponent: ComponentDefinition = {
  id: 'tripletap',
  name: 'Tripletap',
  description: 'Start xovi by triple-pressing the power button',
  version: 'main',
  author: 'rmitchellscott',

  dependencies: ['xovi'],

  checkInstalled: () =>
    CommandBuilders.testExists('/home/root/xovi-tripletap/uninstall.sh'),

  install: () => ({
    script:
      'cd /home/root && wget -qO- https://raw.githubusercontent.com/rmitchellscott/xovi-tripletap/main/install.sh | bash',
    description: 'Download and run tripletap installer',
  }),

  uninstall: () => ({
    script: '/home/root/xovi-tripletap/uninstall.sh',
    description: 'Run tripletap uninstaller',
  }),

  maintenanceCommands: [
    {
      id: 'enable',
      label: 'Re-enable After Updates',
      description: 'Re-enable tripletap service (run after software updates)',
      command: () => ({
        script: '/home/root/xovi-tripletap/enable.sh',
        description: 'Enable tripletap service',
      }),
    },
    {
      id: 'disable',
      label: 'Disable Service',
      description: 'Stop and disable the tripletap systemd service',
      command: () => ({
        script: 'systemctl disable xovi-tripletap --now',
        description: 'Disable tripletap service',
      }),
    },
  ],

  category: 'enhancement',
  tags: ['activation', 'convenience'],
  requiresReboot: false,
}
