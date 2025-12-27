import { CommandGenerator, DeviceType } from './types'

export interface SystemTask {
  id: string
  label: string
  description: string
  deviceTypes?: DeviceType[]
  command: CommandGenerator
  requiresTerminal?: boolean
  needsWriteableRoot?: boolean
}

export const systemTasks: SystemTask[] = [
  {
    id: 'disable-updates',
    label: 'Disable Auto-Updates',
    description: 'Prevent automatic software updates',
    command: () => [
      {
        script: 'systemctl stop update-engine.service',
        description: 'Stop update service',
      },
      {
        script: 'systemctl disable update-engine.service',
        description: 'Disable update service',
      },
    ],
    requiresTerminal: true,
    needsWriteableRoot: true,
  },
  {
    id: 'enable-updates',
    label: 'Enable Auto-Updates',
    description: 'Re-enable automatic software updates',
    command: () => [
      {
        script: 'systemctl enable update-engine.service',
        description: 'Enable update service',
      },
      {
        script: 'systemctl start update-engine.service',
        description: 'Start update service',
      },
    ],
    requiresTerminal: true,
    needsWriteableRoot: false,
  },
]
