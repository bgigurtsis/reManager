import { ComponentDefinition, CommandContext, HookExecutionResult } from '../types'
import { DependencyResolver } from './dependency-resolver'
import { CommandExecutor } from './command-executor'

export interface InstallationProgress {
  currentComponent: string
  totalComponents: number
  currentIndex: number
  status: 'pending' | 'installing' | 'completed' | 'error'
  message?: string
}

export type ProgressCallback = (progress: InstallationProgress) => void
export type HookCallback = (hookResult: HookExecutionResult) => Promise<void>

export interface ComponentInstaller {
  install(
    componentIds: string[],
    context: CommandContext,
    onProgress?: ProgressCallback,
    onHook?: HookCallback
  ): Promise<{ success: boolean; errors: string[] }>

  uninstall(
    componentIds: string[],
    context: CommandContext,
    onProgress?: ProgressCallback
  ): Promise<{ success: boolean; errors: string[] }>

  enable(
    componentId: string,
    context: CommandContext
  ): Promise<{ success: boolean; error?: string }>

  disable(
    componentId: string,
    context: CommandContext
  ): Promise<{ success: boolean; error?: string }>
}

export function createComponentInstaller(
  getComponent: (id: string) => ComponentDefinition | undefined,
  getAllComponents: () => Map<string, ComponentDefinition>,
  executeCommand: (cmd: string) => Promise<boolean>
): ComponentInstaller {
  const resolver = new DependencyResolver(getAllComponents())
  const executor = new CommandExecutor(executeCommand)

  return {
    async install(
      componentIds: string[],
      context: CommandContext,
      onProgress?: ProgressCallback,
      onHook?: HookCallback
    ): Promise<{ success: boolean; errors: string[] }> {
      const errors: string[] = []

      let resolved: string[]
      try {
        resolved = resolver.resolve(componentIds)
      } catch (error) {
        return {
          success: false,
          errors: [(error as Error).message],
        }
      }

      for (let i = 0; i < resolved.length; i++) {
        const componentId = resolved[i]
        const component = getComponent(componentId)

        if (!component) {
          errors.push(`Component not found: ${componentId}`)
          continue
        }

        const componentContext = {
          ...context,
          isInstalled: context.componentsStatus[componentId] || false,
        }

        onProgress?.({
          currentComponent: component.name,
          totalComponents: resolved.length,
          currentIndex: i,
          status: 'installing',
          message: `Installing ${component.name}...`,
        })

        try {
          if (component.preInstall) {
            const hookResult = await component.preInstall.execute(componentContext)
            if (hookResult && onHook) {
              await onHook(hookResult)
            }
          }

          const commands = component.install(componentContext)
          const success = await executor.execute(commands)

          if (!success) {
            throw new Error(`Installation command failed for ${component.name}`)
          }

          if (component.postInstall) {
            const hookResult = await component.postInstall.execute(componentContext)
            if (hookResult && onHook) {
              await onHook(hookResult)
            }
          }

          onProgress?.({
            currentComponent: component.name,
            totalComponents: resolved.length,
            currentIndex: i,
            status: 'completed',
            message: `${component.name} installed successfully`,
          })
        } catch (error) {
          const errorMsg = `Failed to install ${component.name}: ${(error as Error).message}`
          errors.push(errorMsg)

          onProgress?.({
            currentComponent: component.name,
            totalComponents: resolved.length,
            currentIndex: i,
            status: 'error',
            message: errorMsg,
          })
        }
      }

      return {
        success: errors.length === 0,
        errors,
      }
    },

    async uninstall(
      componentIds: string[],
      context: CommandContext,
      onProgress?: ProgressCallback
    ): Promise<{ success: boolean; errors: string[] }> {
      const errors: string[] = []

      for (let i = 0; i < componentIds.length; i++) {
        const componentId = componentIds[i]
        const component = getComponent(componentId)

        if (!component) {
          errors.push(`Component not found: ${componentId}`)
          continue
        }

        if (!component.uninstall) {
          errors.push(`${component.name} does not support uninstall`)
          continue
        }

        const componentContext = {
          ...context,
          isInstalled: context.componentsStatus[componentId] || false,
        }

        onProgress?.({
          currentComponent: component.name,
          totalComponents: componentIds.length,
          currentIndex: i,
          status: 'installing',
          message: `Uninstalling ${component.name}...`,
        })

        try {
          if (component.preUninstall) {
            await component.preUninstall.execute(componentContext)
          }

          const commands = component.uninstall(componentContext)
          const success = await executor.execute(commands)

          if (!success) {
            throw new Error(`Uninstall command failed for ${component.name}`)
          }

          if (component.postUninstall) {
            await component.postUninstall.execute(componentContext)
          }

          onProgress?.({
            currentComponent: component.name,
            totalComponents: componentIds.length,
            currentIndex: i,
            status: 'completed',
            message: `${component.name} uninstalled successfully`,
          })
        } catch (error) {
          const errorMsg = `Failed to uninstall ${component.name}: ${(error as Error).message}`
          errors.push(errorMsg)

          onProgress?.({
            currentComponent: component.name,
            totalComponents: componentIds.length,
            currentIndex: i,
            status: 'error',
            message: errorMsg,
          })
        }
      }

      return {
        success: errors.length === 0,
        errors,
      }
    },

    async enable(
      componentId: string,
      context: CommandContext
    ): Promise<{ success: boolean; error?: string }> {
      const component = getComponent(componentId)

      if (!component) {
        return {
          success: false,
          error: `Component not found: ${componentId}`,
        }
      }

      if (!component.enable) {
        return {
          success: false,
          error: `${component.name} does not support enable`,
        }
      }

      const componentContext = {
        ...context,
        isInstalled: context.componentsStatus[componentId] || false,
      }

      try {
        const commands = component.enable(componentContext)
        const success = await executor.execute(commands)

        if (!success) {
          throw new Error(`Enable command failed for ${component.name}`)
        }

        return { success: true }
      } catch (error) {
        return {
          success: false,
          error: `Failed to enable ${component.name}: ${(error as Error).message}`,
        }
      }
    },

    async disable(
      componentId: string,
      context: CommandContext
    ): Promise<{ success: boolean; error?: string }> {
      const component = getComponent(componentId)

      if (!component) {
        return {
          success: false,
          error: `Component not found: ${componentId}`,
        }
      }

      if (!component.disable) {
        return {
          success: false,
          error: `${component.name} does not support disable`,
        }
      }

      const componentContext = {
        ...context,
        isInstalled: context.componentsStatus[componentId] || false,
      }

      try {
        const commands = component.disable(componentContext)
        const success = await executor.execute(commands)

        if (!success) {
          throw new Error(`Disable command failed for ${component.name}`)
        }

        return { success: true }
      } catch (error) {
        return {
          success: false,
          error: `Failed to disable ${component.name}: ${(error as Error).message}`,
        }
      }
    },
  }
}
