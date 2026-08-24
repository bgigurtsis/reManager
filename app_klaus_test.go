package main

import "testing"

func TestParseKlausPairingDetailsPrefersUSB(t *testing.T) {
	output := `Klaus reMarkable pairing
USB address: https://10.11.99.1:2001
Wi-Fi address: https://192.168.1.9:2001
Username: klaus
Pairing password: private-secret
`
	details, err := parseKlausPairingDetails(output)
	if err != nil {
		t.Fatal(err)
	}
	if details.Address != "https://10.11.99.1:2001" {
		t.Errorf("address = %q", details.Address)
	}
	if details.Username != "klaus" || details.Password != "private-secret" {
		t.Errorf("unexpected credentials: username=%q password-present=%v", details.Username, details.Password != "")
	}
}

func TestParseKlausPairingDetailsRequiresEveryField(t *testing.T) {
	_, err := parseKlausPairingDetails("USB address: https://10.11.99.1:2001\nUsername: klaus\n")
	if err == nil {
		t.Fatal("expected incomplete output to fail")
	}
}

func TestParseKlausPairingDetailsUsesConnectedWifiAddress(t *testing.T) {
	output := `USB address: https://10.11.99.1:2001
Wi-Fi address: https://192.168.1.9:2001
Username: klaus
Pairing password: private-secret
`
	details, err := parseKlausPairingDetailsForHost(output, "192.168.1.9")
	if err != nil {
		t.Fatal(err)
	}
	if details.Address != "https://192.168.1.9:2001" {
		t.Errorf("address = %q", details.Address)
	}
}
