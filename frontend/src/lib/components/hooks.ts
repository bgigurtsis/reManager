import { LifecycleHook, HookExecutionResult } from './types'

export const CommonHooks = {
  rebuildHashtableDialog: (): LifecycleHook => ({
    type: 'dialog',
    execute: async (): Promise<HookExecutionResult> => {
      return {
        dialogConfig: {
          title: 'Rebuild Qt Resources',
          message:
            'This process will restart the tablet interface twice and may take up to 2 minutes.',
          steps: [
            'Restart the tablet interface',
            'Ask for your passcode (if you have one set)',
            'Generate hashtable (~1 minute)',
            'Restart the tablet interface again',
          ],
          confirmText: 'Ready, Proceed',
          inProgressMessage: 'Please enter your passcode on the tablet if prompted',
        },
        command: {
          script: '/home/root/xovi/rebuild_hashtable',
          description: 'Rebuild Qt resource hashtable',
        },
      }
    },
  }),

  confirmOverwrite: (_componentName: string): LifecycleHook => ({
    type: 'confirmation',
    execute: async (ctx): Promise<void> => {
      if (ctx.isInstalled) {
        return
      }
    },
  }),
}
