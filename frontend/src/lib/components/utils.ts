import { CommandResult, DeviceArchitecture } from './types'

export const CommandBuilders = {
  downloadAndExtract: (
    url: string,
    dest: string,
    archiveType: 'zip' | 'tar.gz' = 'zip'
  ): CommandResult => ({
    script:
      archiveType === 'zip'
        ? `./curl -Lo temp.zip ${url} && unzip -o -d ${dest} temp.zip && rm temp.zip`
        : `./curl -Lo temp.tar.gz ${url} && tar -xzf temp.tar.gz -C ${dest} && rm temp.tar.gz`,
    description: `Download and extract from ${url}`,
  }),

  copyFile: (src: string, dest: string): CommandResult => ({
    script: `cp ${src} ${dest}`,
    description: `Copy ${src} to ${dest}`,
  }),

  testExists: (path: string, type: 'file' | 'directory' = 'file'): CommandResult => ({
    script:
      type === 'file'
        ? `test -f ${path} && echo 'yes' || echo 'no'`
        : `test -d ${path} && echo 'yes' || echo 'no'`,
    description: `Check if ${type} exists: ${path}`,
  }),

  chain: (...commands: CommandResult[]): CommandResult => ({
    script: commands.map((c) => c.script).join(' && '),
    description: commands
      .map((c) => c.description)
      .filter(Boolean)
      .join('; '),
  }),

  conditional: (condition: string, thenCmd: string, elseCmd?: string): CommandResult => ({
    script: elseCmd
      ? `${condition} && { ${thenCmd}; } || { ${elseCmd}; }`
      : `${condition} && { ${thenCmd}; }`,
    description: 'Conditional execution',
  }),

  removeFile: (path: string): CommandResult => ({
    script: `rm -f ${path}`,
    description: `Remove file ${path}`,
  }),

  removeDirectory: (path: string): CommandResult => ({
    script: `rm -rf ${path}`,
    description: `Remove directory ${path}`,
  }),

  changeDirectory: (path: string): CommandResult => ({
    script: `cd ${path}`,
    description: `Change to directory ${path}`,
  }),

  runCommand: (cmd: string, description?: string): CommandResult => ({
    script: cmd,
    description: description || cmd,
  }),
}

export const ArchUtils = {
  getArchiveArch: (arch: DeviceArchitecture): string => {
    return arch === 'arm32' ? 'arm32-testing' : 'aarch64'
  },

  getDownloadArch: (arch: DeviceArchitecture): string => {
    return arch
  },
}

export const CommandUtils = {
  checkWriteable: (): CommandResult => ({
    script: `awk '$2 == "/" {print $4}' /proc/mounts | grep -q "\\brw\\b" && echo "rw" || echo "ro"`,
    description: 'Check if root filesystem is writeable',
  }),

  makeWriteable: (): CommandResult[] => [
    { script: 'mount -o remount,rw /', description: 'Remount root as read-write' },
    { script: 'umount -R /etc', description: 'Unmount /etc overlay' },
  ],

  wrapWithWriteableRoot: (
    commands: CommandResult | CommandResult[],
    device: import('./types').DeviceType
  ): CommandResult[] => {
    const cmdArray = Array.isArray(commands) ? commands : [commands]

    if (device === 'rmpp' || device === 'rmppm') {
      return [
        {
          script: `if ! awk '$2 == "/" {print $4}' /proc/mounts | grep -q "\\brw\\b"; then mount -o remount,rw / && umount -R /etc; fi`,
          description: 'Ensure root filesystem is writeable',
        },
        ...cmdArray,
      ]
    }

    return cmdArray
  },
}
