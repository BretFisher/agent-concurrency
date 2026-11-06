package main

import (
	"github.com/BretFisher/agent-concurrency/internal/greeting"
	"log"
	"net/http"
	"time"
)

func main() {
	server := &http.Server{Addr: ":8080", Handler: http.HandlerFunc(greeting.Handler), ReadHeaderTimeout: 5 * time.Second}
	log.Fatal(server.ListenAndServe())
}
