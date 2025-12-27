import { ComponentDefinition } from '../types'

export class DependencyResolver {
  constructor(private components: Map<string, ComponentDefinition>) {}

  resolve(componentIds: string[]): string[] {
    const resolved: string[] = []
    const visited = new Set<string>()
    const visiting = new Set<string>()

    const visit = (id: string) => {
      if (visited.has(id)) return
      if (visiting.has(id)) {
        throw new Error(`Circular dependency detected: ${id}`)
      }

      const component = this.components.get(id)
      if (!component) {
        throw new Error(`Component not found: ${id}`)
      }

      visiting.add(id)

      for (const depId of component.dependencies) {
        visit(depId)
      }

      visiting.delete(id)
      visited.add(id)
      resolved.push(id)
    }

    for (const id of componentIds) {
      visit(id)
    }

    return resolved
  }

  getDependencies(componentId: string): string[] {
    const deps = new Set<string>()

    const collect = (id: string) => {
      const component = this.components.get(id)
      if (!component) return

      for (const depId of component.dependencies) {
        if (!deps.has(depId)) {
          deps.add(depId)
          collect(depId)
        }
      }
    }

    collect(componentId)
    return Array.from(deps)
  }

  getDependents(componentId: string): string[] {
    const dependents: string[] = []
    for (const [id, component] of this.components) {
      if (component.dependencies.includes(componentId)) {
        dependents.push(id)
      }
    }
    return dependents
  }

  validateSelection(componentIds: string[]): { valid: boolean; errors: string[] } {
    const errors: string[] = []

    try {
      const resolved = this.resolve(componentIds)

      for (const id of resolved) {
        const component = this.components.get(id)!
        const missing = component.dependencies.filter((depId) => !resolved.includes(depId))

        if (missing.length > 0) {
          errors.push(`${component.name} requires: ${missing.join(', ')}`)
        }
      }
    } catch (error) {
      errors.push((error as Error).message)
    }

    return {
      valid: errors.length === 0,
      errors,
    }
  }
}
