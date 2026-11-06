package greeting

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHandler(t *testing.T) {
	for _, tc := range []struct {
		name, query, body string
		status            int
	}{
		{"default", "", "Hello, world!\n", 200},
		{"named", "?name=Bret", "Hello, Bret!\n", 200},
		{"too long", "?name=" + strings.Repeat("x", 41), "name too long\n", 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			Handler(w, httptest.NewRequest("GET", "/"+tc.query, nil))
			if w.Code != tc.status || w.Body.String() != tc.body {
				t.Fatalf("got %d %q; want %d %q", w.Code, w.Body.String(), tc.status, tc.body)
			}
		})
	}
}
