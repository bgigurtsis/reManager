package vellum

import "testing"

func TestParseConstraint(t *testing.T) {
	tests := []struct {
		entry   string
		name    string
		op      string
		version string
	}{
		{"tripletap", "tripletap", "", ""},
		{"xovi-extensions<18.0.0", "xovi-extensions", "<", "18.0.0"},
		{"qt-resource-rebuilder<18.0.0", "qt-resource-rebuilder", "<", "18.0.0"},
		{"liboxide=3.1-r1", "liboxide", "=", "3.1-r1"},
		{"appload>=0.5.0", "appload", ">=", "0.5.0"},
		{"foo<=2.0", "foo", "<=", "2.0"},
		{"foo>1.0", "foo", ">", "1.0"},
	}

	for _, tt := range tests {
		got := ParseConstraint(tt.entry)
		if got.Name != tt.name || got.Op != tt.op || got.Version != tt.version {
			t.Errorf("ParseConstraint(%q) = {%q %q %q}, want {%q %q %q}",
				tt.entry, got.Name, got.Op, got.Version, tt.name, tt.op, tt.version)
		}
	}
}

func TestProhibitsRealMetadataConflicts(t *testing.T) {
	tests := []struct {
		entry   string
		version string
		want    bool
	}{
		{"xovi-extensions<18.0.0", "16.0.0-r2", true},
		{"xovi-extensions<18.0.0", "17.0.0-r5", true},
		{"xovi-extensions<18.0.0", "18.0.0-r6", false},
		{"xovi-extensions<18.0.0", "19.0.0-r3", false},

		{"qt-resource-rebuilder<18.0.0", "16.0.0-r2", true},
		{"qt-resource-rebuilder<18.0.0", "17.0.0-r5", true},
		{"qt-resource-rebuilder<18.0.0", "18.0.0-r6", false},
		{"qt-resource-rebuilder<18.0.0", "19.0.0-r3", false},
	}

	for _, tt := range tests {
		if got := ParseConstraint(tt.entry).Prohibits(tt.version); got != tt.want {
			t.Errorf("ParseConstraint(%q).Prohibits(%q) = %v, want %v",
				tt.entry, tt.version, got, tt.want)
		}
	}
}

func TestProhibitsBareNameMatchesEveryVersion(t *testing.T) {
	c := ParseConstraint("tripletap")
	for _, version := range []string{"1.0.0-r4", "1.1.0-r0", "2.0.0-r0", ""} {
		if !c.Prohibits(version) {
			t.Errorf("bare name should prohibit %q", version)
		}
	}
}

func TestProhibitsFailsOpen(t *testing.T) {
	if ParseConstraint("tripletap<2.0").Prohibits("") {
		t.Error("unknown version should not be prohibited")
	}
	if (VersionConstraint{Name: "foo", Op: "~="}).Prohibits("1.0") {
		t.Error("unrecognized operator should not prohibit")
	}
	if (VersionConstraint{Name: "foo", Op: "<"}).Prohibits("1.0") {
		t.Error("missing constraint version should not prohibit")
	}
}

func TestProhibitsVersionedTripletapConflict(t *testing.T) {
	c := ParseConstraint("tripletap<2.0")
	if !c.Prohibits("1.1.0-r0") {
		t.Error("tripletap 1.1.0-r0 should conflict with tripletap<2.0")
	}
	if c.Prohibits("2.0.0-r0") {
		t.Error("tripletap 2.0.0-r0 should not conflict with tripletap<2.0")
	}
}

func TestStripDepVersionUnchanged(t *testing.T) {
	tests := map[string]string{
		"liboxide=3.1-r1":        "liboxide",
		"oxide-utils=3.1-r1":     "oxide-utils",
		"xovi-extensions<18.0.0": "xovi-extensions",
		"lockscreen_hook":        "lockscreen_hook",
		"/bin/sh":                "/bin/sh",
	}

	for dep, want := range tests {
		if got := stripDepVersion(dep); got != want {
			t.Errorf("stripDepVersion(%q) = %q, want %q", dep, got, want)
		}
	}
}

func conflictStore() *MetadataStore {
	pm := PackagesMetadata{
		Packages: map[string]map[string]PackageVersion{
			"xovi": {
				"0.3.1-r1": {Arch: []string{"aarch64"}},
				"0.3.3-r2": {Conflicts: []string{"xovi-extensions<18.0.0"}, Arch: []string{"aarch64"}},
			},
			"xovi-extensions": {
				"17.0.0-r5": {Arch: []string{"aarch64"}},
				"19.0.0-r3": {Conflicts: []string{"qt-resource-rebuilder<18.0.0"}, Arch: []string{"aarch64"}},
			},
			"qt-resource-rebuilder": {
				"17.0.0-r5": {Arch: []string{"aarch64"}},
				"19.0.0-r3": {Arch: []string{"aarch64"}},
			},
			"tripletap": {
				"1.1.0-r0": {Conflicts: []string{"launcherctl"}, Arch: []string{"aarch64"}},
			},
			"launcherctl": {
				"3.1-r1": {Conflicts: []string{"tripletap"}, Arch: []string{"aarch64"}},
			},
		},
	}
	return &MetadataStore{packages: pm, providers: buildProviderIndex(&pm), loaded: true}
}

func TestFindConflictsVersionedForwardDirection(t *testing.T) {
	m := conflictStore()

	conflicts := m.FindConflicts(map[string]string{"xovi-extensions": "17.0.0-r5"}, nil, "", "", "aarch64")
	if _, found := conflicts["xovi"]; !found {
		t.Error("xovi should conflict with installed xovi-extensions 17.0.0-r5")
	}

	conflicts = m.FindConflicts(map[string]string{"xovi-extensions": "19.0.0-r3"}, nil, "", "", "aarch64")
	if c, found := conflicts["xovi"]; found {
		t.Errorf("xovi should not conflict with xovi-extensions 19.0.0-r3, got %+v", c)
	}
}

func TestFindConflictsVersionedReverseDirection(t *testing.T) {
	m := conflictStore()

	conflicts := m.FindConflicts(map[string]string{"xovi-extensions": "19.0.0-r3"}, nil, "", "", "aarch64")
	if c, found := conflicts["qt-resource-rebuilder"]; found {
		t.Errorf("qt-resource-rebuilder best version 19.0.0-r3 is not prohibited, got %+v", c)
	}
}

func oldExtensionsStore() *MetadataStore {
	pm := PackagesMetadata{
		Packages: map[string]map[string]PackageVersion{
			"xovi": {
				"0.3.1-r1": {Arch: []string{"aarch64"}},
				"0.3.3-r2": {Conflicts: []string{"xovi-extensions<18.0.0"}, Arch: []string{"aarch64"}},
			},
			"xovi-extensions": {
				"17.0.0-r5": {Arch: []string{"aarch64"}},
			},
		},
	}
	return &MetadataStore{packages: pm, providers: buildProviderIndex(&pm), loaded: true}
}

func TestFindConflictsUsesInstalledVersionNotLatest(t *testing.T) {
	m := oldExtensionsStore()

	conflicts := m.FindConflicts(map[string]string{"xovi": "0.3.3-r2"}, nil, "", "", "aarch64")
	if _, found := conflicts["xovi-extensions"]; !found {
		t.Error("xovi 0.3.3-r2 conflicts should apply to xovi-extensions 17.0.0-r5")
	}

	conflicts = m.FindConflicts(map[string]string{"xovi": "0.3.1-r1"}, nil, "", "", "aarch64")
	if c, found := conflicts["xovi-extensions"]; found {
		t.Errorf("xovi 0.3.1-r1 declares no conflicts, got %+v", c)
	}
}

func TestFindConflictsAllowsNewerUnprohibitedVersion(t *testing.T) {
	m := conflictStore()

	conflicts := m.FindConflicts(map[string]string{"xovi": "0.3.3-r2"}, nil, "", "", "aarch64")
	if c, found := conflicts["xovi-extensions"]; found {
		t.Errorf("xovi-extensions best version 19.0.0-r3 is outside xovi-extensions<18.0.0, got %+v", c)
	}
}

func TestFindConflictsAgainstQueue(t *testing.T) {
	m := conflictStore()

	conflicts := m.FindConflicts(nil, []string{"launcherctl"}, "", "", "aarch64")
	c, found := conflicts["tripletap"]
	if !found {
		t.Fatal("tripletap should conflict with queued launcherctl")
	}
	if c.ConflictsWith != "launcherctl" || !c.Queued {
		t.Errorf("got %+v, want launcherctl queued", c)
	}
}

func TestFindConflictsMarksInstalledVersusQueued(t *testing.T) {
	m := conflictStore()

	conflicts := m.FindConflicts(map[string]string{"launcherctl": "3.1-r1"}, nil, "", "", "aarch64")
	c := conflicts["tripletap"]
	if c.ConflictsWith != "launcherctl" || c.Queued {
		t.Errorf("got %+v, want launcherctl installed", c)
	}
}

func TestFindConflictsSkipsPresentPackages(t *testing.T) {
	m := conflictStore()

	conflicts := m.FindConflicts(map[string]string{"launcherctl": "3.1-r1", "tripletap": "1.1.0-r0"}, nil, "", "", "aarch64")
	if _, found := conflicts["tripletap"]; found {
		t.Error("already-installed packages should not be reported as conflicts")
	}
}
