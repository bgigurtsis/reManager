import { componentRegistry } from '../registry'
import { xoviComponent } from './xovi'
import { qtResourceRebuilderComponent } from './qt-resource-rebuilder'
import { tripletapComponent } from './tripletap'
import { rmHacksComponent } from './rm-hacks'
import { apploadComponent } from './appload'

componentRegistry.register(xoviComponent)
componentRegistry.register(qtResourceRebuilderComponent)
componentRegistry.register(tripletapComponent)
componentRegistry.register(rmHacksComponent)
componentRegistry.register(apploadComponent)

export {
  xoviComponent,
  qtResourceRebuilderComponent,
  tripletapComponent,
  rmHacksComponent,
  apploadComponent,
}
