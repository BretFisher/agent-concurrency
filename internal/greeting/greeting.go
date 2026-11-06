// Package greeting provides the demo HTTP handler.
package greeting

import (
	"fmt"
	"net/http"
)

// Handler returns a greeting for a short name.
func Handler(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("name")
	if name == "" {
		name = "world"
	}
	if len(name) > 40 {
		http.Error(w, "name too long", http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	if _, err := fmt.Fprintf(w, "Hello, %s!\n", name); err != nil {
		return
	}
}
