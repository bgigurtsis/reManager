package definitions

import "reManager/internal/component"

func RegisterAll(registry *component.Registry) {
	registry.Register(XoviComponent)
	registry.Register(QtResourceRebuilderComponent)
	registry.Register(TripletapComponent)
	registry.Register(RmHacksComponent)
	registry.Register(ApploadComponent)
}

func init() {
	RegisterAll(component.DefaultRegistry)
}

var AllComponents = []*component.ComponentDefinition{
	XoviComponent,
	QtResourceRebuilderComponent,
	TripletapComponent,
	RmHacksComponent,
	ApploadComponent,
}
