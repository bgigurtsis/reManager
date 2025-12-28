package component

import (
	"sort"
	"strings"
	"sync"
)

type Registry struct {
	mu         sync.RWMutex
	components map[string]*ComponentDefinition
}

func NewRegistry() *Registry {
	return &Registry{
		components: make(map[string]*ComponentDefinition),
	}
}

func (r *Registry) Register(component *ComponentDefinition) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.components[component.ID] = component
}

func (r *Registry) Get(id string) *ComponentDefinition {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.components[id]
}

func (r *Registry) GetAll() []*ComponentDefinition {
	r.mu.RLock()
	defer r.mu.RUnlock()

	result := make([]*ComponentDefinition, 0, len(r.components))
	for _, comp := range r.components {
		result = append(result, comp)
	}

	// Sort alphabetically by name for stable ordering
	sort.Slice(result, func(i, j int) bool {
		return result[i].Name < result[j].Name
	})

	return result
}

func (r *Registry) GetAllAsMap() map[string]*ComponentDefinition {
	r.mu.RLock()
	defer r.mu.RUnlock()

	result := make(map[string]*ComponentDefinition, len(r.components))
	for id, comp := range r.components {
		result[id] = comp
	}
	return result
}

func (r *Registry) GetByCategory(category string) []*ComponentDefinition {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var result []*ComponentDefinition
	for _, comp := range r.components {
		if comp.Category == category {
			result = append(result, comp)
		}
	}
	return result
}

func (r *Registry) Search(query string) []*ComponentDefinition {
	r.mu.RLock()
	defer r.mu.RUnlock()

	lowerQuery := strings.ToLower(query)
	var result []*ComponentDefinition

	for _, comp := range r.components {
		if strings.Contains(strings.ToLower(comp.Name), lowerQuery) ||
			strings.Contains(strings.ToLower(comp.Description), lowerQuery) ||
			containsTag(comp.Tags, lowerQuery) {
			result = append(result, comp)
		}
	}
	return result
}

func containsTag(tags []string, query string) bool {
	for _, tag := range tags {
		if strings.Contains(strings.ToLower(tag), query) {
			return true
		}
	}
	return false
}

var DefaultRegistry = NewRegistry()
