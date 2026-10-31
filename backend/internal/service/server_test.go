package service

import (
	"bytes"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	_ "github.com/lib/pq"
)

const testToken = "0123456789abcdef0123456789abcdef0123456789abcdef"

func validInput() InquiryInput {
	return InquiryInput{RequestID: strings.Repeat("1", 32), PageSlug: "test-page", NodeID: "node_valid123", Kind: "consultation", Name: "نام آزمون", Contact: "test@example.com", Message: "درخواست نمونه", ClientHash: strings.Repeat("a", 64)}
}

func TestValidationAndAuth(t *testing.T) {
	in := validInput()
	if !normalizeInput(&in) {
		t.Fatal("valid inquiry rejected")
	}
	for _, alter := range []func(*InquiryInput){
		func(i *InquiryInput) { i.PageSlug = "../admin" },
		func(i *InquiryInput) { i.NodeID = "node_a" },
		func(i *InquiryInput) { i.Kind = "confirmed-booking" },
		func(i *InquiryInput) { i.Name = "\x00evil" },
		func(i *InquiryInput) { i.Message = strings.Repeat("x", 2001) },
		func(i *InquiryInput) { i.ClientHash = "raw-ip-address" },
	} {
		in := validInput()
		alter(&in)
		if normalizeInput(&in) {
			t.Fatalf("accepted invalid input: %#v", in)
		}
	}
	h := New(nil, testToken)
	for _, header := range []string{"", "Bearer wrong", testToken} {
		r := httptest.NewRequest(http.MethodGet, "/v1/inquiries", nil)
		r.Header.Set("Authorization", header)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 401 {
			t.Fatalf("unauthorized header %q: %d", header, w.Code)
		}
	}
}

// Set NOVEX_TEST_DATABASE_URL to an isolated PostgreSQL database. Each run uses
// a fresh, uniquely named schema; it never truncates the user's existing tables.
func integrationDB(t *testing.T) *sql.DB {
	t.Helper()
	dsn := os.Getenv("NOVEX_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("NOVEX_TEST_DATABASE_URL is not set")
	}
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	root, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	if err = root.Ping(); err != nil {
		t.Fatal(err)
	}
	var random [8]byte
	if _, err = rand.Read(random[:]); err != nil {
		t.Fatal(err)
	}
	schema := "novex_test_" + hex.EncodeToString(random[:])
	if _, err = root.Exec(`CREATE SCHEMA "` + schema + `"`); err != nil {
		t.Fatal(err)
	}
	query := parsed.Query()
	query.Set("search_path", schema)
	parsed.RawQuery = query.Encode()
	db, err := sql.Open("postgres", parsed.String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		db.Close()
		_, err := root.Exec(`DROP SCHEMA "` + schema + `" CASCADE`)
		if err != nil {
			t.Error(err)
		}
		root.Close()
	})
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err = Migrate(ctx, db); err != nil {
		t.Fatal(err)
	}
	if err = Migrate(ctx, db); err != nil {
		t.Fatalf("migration is not repeatable: %v", err)
	}
	return db
}

func request(t *testing.T, client *http.Client, base, method, path string, body any) (int, map[string]any) {
	t.Helper()
	var reader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		reader = bytes.NewReader(data)
	}
	r, err := http.NewRequest(method, base+path, reader)
	if err != nil {
		t.Fatal(err)
	}
	r.Header.Set("Authorization", "Bearer "+testToken)
	if body != nil {
		r.Header.Set("Content-Type", "application/json")
	}
	res, err := client.Do(r)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var result map[string]any
	if err = json.NewDecoder(res.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	return res.StatusCode, result
}

func TestPostgresInquiryLifecycle(t *testing.T) {
	db := integrationDB(t)
	srv := httptest.NewServer(New(db, testToken))
	defer srv.Close()
	client := srv.Client()
	malformed, _ := http.NewRequest("POST", srv.URL+"/v1/inquiries", strings.NewReader(`{"unexpected":true}`))
	malformed.Header.Set("Authorization", "Bearer "+testToken)
	malformed.Header.Set("Content-Type", "application/json")
	bad, err := client.Do(malformed)
	if err != nil {
		t.Fatal(err)
	}
	bad.Body.Close()
	if bad.StatusCode != 400 {
		t.Fatalf("unknown JSON field: %d", bad.StatusCode)
	}
	in := validInput()
	status, created := request(t, client, srv.URL, "POST", "/v1/inquiries", in)
	if status != 201 || created["ok"] != true || created["replayed"] != false {
		t.Fatalf("create: %d %#v", status, created)
	}
	id := created["id"].(string)
	status, replay := request(t, client, srv.URL, "POST", "/v1/inquiries", in)
	if status != 200 || replay["id"] != id || replay["replayed"] != true {
		t.Fatalf("replay: %d %#v", status, replay)
	}
	conflict := in
	conflict.Message = "متفاوت"
	status, _ = request(t, client, srv.URL, "POST", "/v1/inquiries", conflict)
	if status != 409 {
		t.Fatalf("idempotency conflict: %d", status)
	}
	status, listed := request(t, client, srv.URL, "GET", "/v1/inquiries?status=new", nil)
	items := listed["items"].([]any)
	if status != 200 || len(items) != 1 || items[0].(map[string]any)["message"] != in.Message {
		t.Fatalf("list: %d %#v", status, listed)
	}
	status, _ = request(t, client, srv.URL, "PATCH", "/v1/inquiries/"+id, map[string]string{"status": "archived"})
	if status != 200 {
		t.Fatalf("archive: %d", status)
	}
	// A new server instance over the same database must retain the record and status.
	restarted := httptest.NewServer(New(db, testToken))
	defer restarted.Close()
	status, listed = request(t, restarted.Client(), restarted.URL, "GET", "/v1/inquiries?status=archived", nil)
	if status != 200 || len(listed["items"].([]any)) != 1 {
		t.Fatalf("persisted archive: %d %#v", status, listed)
	}
	status, _ = request(t, client, srv.URL, "PATCH", "/v1/inquiries/"+id, map[string]string{"status": "deleted"})
	if status != 422 {
		t.Fatalf("bad status: %d", status)
	}
	status, _ = request(t, client, srv.URL, "DELETE", "/v1/inquiries/"+id, nil)
	if status != 200 {
		t.Fatalf("delete: %d", status)
	}
	status, _ = request(t, client, srv.URL, "DELETE", "/v1/inquiries/"+id, nil)
	if status != 404 {
		t.Fatalf("deleted record remains: %d", status)
	}
}

func TestPostgresConcurrentIdempotencyAndRateLimit(t *testing.T) {
	db := integrationDB(t)
	srv := httptest.NewServer(New(db, testToken))
	defer srv.Close()
	in := validInput()
	var wg sync.WaitGroup
	codes := make(chan int, 12)
	ids := make(chan string, 12)
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			data, _ := json.Marshal(in)
			r, _ := http.NewRequest("POST", srv.URL+"/v1/inquiries", bytes.NewReader(data))
			r.Header.Set("Authorization", "Bearer "+testToken)
			r.Header.Set("Content-Type", "application/json")
			res, err := srv.Client().Do(r)
			if err != nil {
				codes <- 0
				return
			}
			defer res.Body.Close()
			var out map[string]any
			_ = json.NewDecoder(res.Body).Decode(&out)
			codes <- res.StatusCode
			if id, ok := out["id"].(string); ok {
				ids <- id
			}
		}()
	}
	wg.Wait()
	close(codes)
	close(ids)
	for code := range codes {
		if code != 200 && code != 201 {
			t.Fatalf("concurrent request returned %d", code)
		}
	}
	first := ""
	for id := range ids {
		if first == "" {
			first = id
		}
		if id != first {
			t.Fatalf("duplicate ids %s %s", first, id)
		}
	}
	// The duplicate requests count once. The twentieth distinct request succeeds,
	// the next fails, and the failed transaction does not insert a record.
	for i := 2; i <= 21; i++ {
		in.RequestID = fmt.Sprintf("%032x", i)
		code, _ := request(t, srv.Client(), srv.URL, "POST", "/v1/inquiries", in)
		if i <= 20 && code != 201 {
			t.Fatalf("request %d: %d", i, code)
		}
		if i == 21 && code != 429 {
			t.Fatalf("rate limit: %d", code)
		}
	}
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM novex_inquiries`).Scan(&count); err != nil || count != 20 {
		t.Fatalf("count=%d err=%v", count, err)
	}
}

func TestFutureSchemaAndDatabaseFailureFailClosed(t *testing.T) {
	db := integrationDB(t)
	if _, err := db.Exec(`INSERT INTO novex_schema_migrations(version) VALUES (999)`); err != nil {
		t.Fatal(err)
	}
	if err := Migrate(context.Background(), db); err == nil {
		t.Fatal("accepted a newer schema")
	}
	if _, err := db.Exec(`DELETE FROM novex_schema_migrations WHERE version=999`); err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(New(db, testToken))
	defer srv.Close()
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	status, result := request(t, srv.Client(), srv.URL, "POST", "/v1/inquiries", validInput())
	if status != 503 || result["ok"] != false {
		t.Fatalf("database outage was not rejected: %d %#v", status, result)
	}
	resp, err := srv.Client().Get(srv.URL + "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 503 {
		t.Fatalf("unhealthy database reported healthy: %d", resp.StatusCode)
	}
}
