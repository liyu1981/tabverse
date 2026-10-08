package api

import (
	"net/http"
	"strings"
)

// Pairing a browser extension from the console's own page.
//
// The invite-code flow (`POST /console/api/v1/auth/pair`) is what a self-hosted
// deployment uses: the account mints a code, and whoever holds it redeems it.
// That is one step too many for the *official* server, where the person at the
// keyboard is the person who owns the account and wants their own browser in.
//
// So: the page signs in (this is the console's own session), asks for a device
// name, and this endpoint mints a device and its token for the account the
// session resolves to. The page then hands the token to the extension over
// `chrome.runtime.sendMessage` (the `externally_connectable` channel declared
// by the extension), which saves it as its sync config. See
// adr/0020-official-server-wizard-pairing.md.
//
// The security of the flow is the session: this endpoint reads no invite and no
// admin token, and an operator *looking* at somebody (an assumed identity) is
// refused on it - the same rule every mutating console route follows, because a
// token issued under an assumed identity would outlive the impersonation and
// nobody would be able to say who it belonged to.

func (s *Server) handleConsolePair(w http.ResponseWriter, r *http.Request) {
	var req struct {
		DeviceName string `json:"device_name"`
		// The extension the page is handing the token to. It is recorded on the
		// device row, so an account's device list says which browser asked -
		// and so a page that got its own id wrong is visible rather than silent.
		ExtensionID string `json:"extension_id"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}

	// The account is the session's, never a parameter: a page that could name
	// the account would be a device-token endpoint with extra steps.
	accountID, ok := s.resolveScope(w, r, "")
	if !ok {
		return
	}

	deviceName := strings.TrimSpace(req.DeviceName)
	if deviceName == "" {
		deviceName = "browser extension"
	}
	s.writeDevice(w, r, accountID, deviceName)
}
