import { ComponentDefinition } from './types'

export class ComponentRegistry {
  private components: Map<string, ComponentDefinition>

  constructor() {
    this.components = new Map()
  }

  register(component: ComponentDefinition): void {
    this.components.set(component.id, component)
  }

  get(id: string): ComponentDefinition | undefined {
    return this.components.get(id)
  }

  getAll(): ComponentDefinition[] {
    return Array.from(this.components.values())
  }

  getAllAsMap(): Map<string, ComponentDefinition> {
    return new Map(this.components)
  }

  getByCategory(category: string): ComponentDefinition[] {
    return this.getAll().filter((c) => c.category === category)
  }

  search(query: string): ComponentDefinition[] {
    const lowerQuery = query.toLowerCase()
    return this.getAll().filter(
      (c) =>
        c.name.toLowerCase().includes(lowerQuery) ||
        c.description.toLowerCase().includes(lowerQuery) ||
        c.tags?.some((tag) => tag.toLowerCase().includes(lowerQuery))
    )
  }
}

export const componentRegistry = new ComponentRegistry()
