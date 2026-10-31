package main

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	_ "github.com/lib/pq"
	"github.com/sinaqaffari/novex-code/backend/internal/service"
)

func main() {
	token := os.Getenv("NOVEX_BACKEND_TOKEN")
	if len(token) < 32 || subtle.ConstantTimeCompare([]byte(token), []byte("change-me")) == 1 {
		log.Fatal("NOVEX_BACKEND_TOKEN must be a private, random value of at least 32 characters")
	}
	// lib/pq also accepts standard PGHOST, PGPORT, PGDATABASE, PGUSER and PGPASSWORD.
	db, err := sql.Open("postgres", os.Getenv("DATABASE_URL"))
	if err != nil {
		log.Fatal("database configuration invalid")
	}
	defer db.Close()
	db.SetMaxOpenConns(12)
	db.SetMaxIdleConns(4)
	db.SetConnMaxLifetime(30 * time.Minute)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	err = service.Migrate(ctx, db)
	cancel()
	if err != nil {
		log.Fatalf("database initialization failed: %v", err)
	}
	addr := os.Getenv("LISTEN_ADDR")
	if addr == "" {
		addr = ":8080"
	}
	srv := &http.Server{Addr: addr, Handler: service.New(db, token), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16384}
	go func() {
		log.Printf("Novex backend listening on %s", addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("HTTP server failed: %v", err)
		}
	}()
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	ctx, cancel = context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("shutdown: %v", err)
	}
}
