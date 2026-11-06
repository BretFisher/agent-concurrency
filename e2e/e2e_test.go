//go:build e2e

package e2e

import (
	"context"
	"github.com/BretFisher/agent-concurrency/internal/greeting"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"
)

func TestHTTPGreeting(t *testing.T) {
	// This wait simulates expensive infrastructure setup. It proves no app behavior.
	delay := os.Getenv("SIMULATED_E2E_DELAY")
	if delay != "" {
		d, err := time.ParseDuration(delay)
		if err != nil || d < 0 || d > 2*time.Minute {
			t.Fatal("delay must be between 0 and 2m")
		}
		t.Logf("SIMULATED expensive setup: %s", d)
		time.Sleep(d)
	}
	server := httptest.NewServer(http.HandlerFunc(greeting.Handler))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, "GET", server.URL+"/?name=CI", nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := resp.Body.Close(); err != nil {
			t.Error(err)
		}
	}()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusOK || string(body) != "Hello, CI!\n" {
		t.Fatalf("got %d %q", resp.StatusCode, body)
	}
	if got := resp.Header.Get("Content-Type"); got != "text/plain; charset=utf-8" {
		t.Fatalf("content type: %s", got)
	}
}
