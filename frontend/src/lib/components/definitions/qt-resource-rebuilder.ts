import { ComponentDefinition } from '../types'
import { CommandBuilders } from '../utils'
import { CommonHooks } from '../hooks'

export const qtResourceRebuilderComponent: ComponentDefinition = {
  id: 'qt-resource-rebuilder',
  name: 'Qt Resource Rebuilder',
  description: 'Enables UI modifications like rM Hacks',
  version: 'v16-14112025',

  dependencies: ['xovi'],

  checkInstalled: () =>
    CommandBuilders.testExists('/home/root/xovi/extensions.d/qt-resource-rebuilder.so'),

  install: () =>
    CommandBuilders.copyFile(
      '/home/root/extensions/qt-resource-rebuilder.so',
      '/home/root/xovi/extensions.d/qt-resource-rebuilder.so'
    ),

  postInstall: CommonHooks.rebuildHashtableDialog(),

  uninstall: () =>
    CommandBuilders.removeFile('/home/root/xovi/extensions.d/qt-resource-rebuilder.so'),

  category: 'core',
  tags: ['framework', 'ui-modification'],
  requiresUserConfirmation: true,
}
