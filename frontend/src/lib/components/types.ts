export type DeviceArchitecture = 'arm32' | 'aarch64'
export type DeviceType = 'rm1' | 'rm2' | 'rmpp' | 'rmppm'

export interface CommandContext {
  arch: DeviceArchitecture
  device: DeviceType
  isInstalled: boolean
  componentsStatus: Record<string, boolean>
}

export interface CommandResult {
  script: string
  description?: string
}

export type CommandGenerator = (ctx: CommandContext) => CommandResult | CommandResult[] | null

export interface DialogConfig {
  title: string
  message: string
  steps?: string[]
  confirmText: string
  inProgressMessage?: string
}

export interface HookExecutionResult {
  dialogConfig?: DialogConfig
  command?: CommandResult
}

export interface LifecycleHook {
  type: 'dialog' | 'confirmation' | 'custom'
  execute: (ctx: CommandContext) => Promise<HookExecutionResult | void>
}

export interface MaintenanceCommand {
  id: string
  label: string
  description: string
  command: CommandGenerator
  requiresTerminal?: boolean
  allowStop?: boolean
  needsWriteableRoot?: boolean
  icon?: string
}

export interface ComponentDefinition {
  id: string
  name: string
  description: string
  version: string
  author?: string

  dependencies: string[]

  checkInstalled: CommandGenerator

  install: CommandGenerator
  uninstall?: CommandGenerator
  enable?: CommandGenerator
  disable?: CommandGenerator

  preInstall?: LifecycleHook
  postInstall?: LifecycleHook
  preUninstall?: LifecycleHook
  postUninstall?: LifecycleHook

  maintenanceCommands?: MaintenanceCommand[]

  tags?: string[]
  category?: string
  icon?: string

  requiresReboot?: boolean
  requiresUserConfirmation?: boolean
}
