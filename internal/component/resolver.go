package component

import (
	"fmt"
)

type DependencyResolver struct {
	components map[string]*ComponentDefinition
}

func NewDependencyResolver(components map[string]*ComponentDefinition) *DependencyResolver {
	return &DependencyResolver{components: components}
}

func (r *DependencyResolver) Resolve(componentIDs []string) ([]string, error) {
	resolved := make([]string, 0)
	visited := make(map[string]bool)
	visiting := make(map[string]bool)

	var visit func(id string) error
	visit = func(id string) error {
		if visited[id] {
			return nil
		}
		if visiting[id] {
			return fmt.Errorf("circular dependency detected: %s", id)
		}

		component := r.components[id]
		if component == nil {
			return fmt.Errorf("component not found: %s", id)
		}

		visiting[id] = true

		for _, depID := range component.Dependencies {
			if err := visit(depID); err != nil {
				return err
			}
		}

		delete(visiting, id)
		visited[id] = true
		resolved = append(resolved, id)
		return nil
	}

	for _, id := range componentIDs {
		if err := visit(id); err != nil {
			return nil, err
		}
	}

	return resolved, nil
}

func (r *DependencyResolver) GetDependencies(componentID string) []string {
	deps := make(map[string]bool)

	var collect func(id string)
	collect = func(id string) {
		component := r.components[id]
		if component == nil {
			return
		}

		for _, depID := range component.Dependencies {
			if !deps[depID] {
				deps[depID] = true
				collect(depID)
			}
		}
	}

	collect(componentID)

	result := make([]string, 0, len(deps))
	for dep := range deps {
		result = append(result, dep)
	}
	return result
}

func (r *DependencyResolver) GetDependents(componentID string) []string {
	var dependents []string
	for id, component := range r.components {
		for _, dep := range component.Dependencies {
			if dep == componentID {
				dependents = append(dependents, id)
				break
			}
		}
	}
	return dependents
}

type ValidationResult struct {
	Valid  bool
	Errors []string
}

func (r *DependencyResolver) ValidateSelection(componentIDs []string) ValidationResult {
	var errors []string

	resolved, err := r.Resolve(componentIDs)
	if err != nil {
		return ValidationResult{
			Valid:  false,
			Errors: []string{err.Error()},
		}
	}

	resolvedSet := make(map[string]bool)
	for _, id := range resolved {
		resolvedSet[id] = true
	}

	for _, id := range resolved {
		component := r.components[id]
		if component == nil {
			continue
		}

		var missing []string
		for _, depID := range component.Dependencies {
			if !resolvedSet[depID] {
				missing = append(missing, depID)
			}
		}

		if len(missing) > 0 {
			errors = append(errors, fmt.Sprintf("%s requires: %v", component.Name, missing))
		}
	}

	return ValidationResult{
		Valid:  len(errors) == 0,
		Errors: errors,
	}
}
