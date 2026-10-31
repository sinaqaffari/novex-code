package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

func commerceFixture() map[string]any {
	return map[string]any{
		"version": 1, "counters": map[string]any{"order": 8, "legacyCounter": 9},
		"products": []any{map[string]any{"id": "prd_test", "stock": 3, "legacyField": "kept"}},
		"orders":   []any{}, "customers": []any{}, "discounts": []any{}, "legacyExtension": "kept",
	}
}

func TestCommerceRejectsUnauthorizedAndOversizedRequests(t *testing.T) {
	h := New(nil, testToken)
	for _, method := range []string{http.MethodGet, http.MethodPost, http.MethodPut} {
		r := httptest.NewRequest(method, "/v1/commerce", nil)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("%s unauthorized: %d", method, w.Code)
		}
	}
	r := httptest.NewRequest(http.MethodPost, "/v1/commerce/bootstrap", strings.NewReader(`{"snapshot":"`+strings.Repeat("x", maxCommerceBody)+`"}`))
	r.Header.Set("Authorization", "Bearer "+testToken)
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("oversized body: %d", w.Code)
	}
}

func TestPostgresCommerceBootstrapAndCompareAndSwap(t *testing.T) {
	db := integrationDB(t)
	srv := httptest.NewServer(New(db, testToken))
	defer srv.Close()
	client := srv.Client()
	status, _ := request(t, client, srv.URL, "GET", "/v1/commerce", nil)
	if status != 404 {
		t.Fatalf("uninitialized store: %d", status)
	}
	storeID := strings.Repeat("a", 32)
	hash := strings.Repeat("b", 64)
	fixture := commerceFixture()
	initial := map[string]any{"storeId": storeID, "sourceHash": hash, "snapshot": fixture}
	bad := map[string]any{"storeId": storeID, "sourceHash": hash, "snapshot": map[string]any{"products": nil}}
	status, _ = request(t, client, srv.URL, "POST", "/v1/commerce/bootstrap", bad)
	if status != 422 {
		t.Fatalf("invalid snapshot: %d", status)
	}
	status, result := request(t, client, srv.URL, "POST", "/v1/commerce/bootstrap", initial)
	if status != 201 || result["replayed"] != false {
		t.Fatalf("bootstrap: %d %#v", status, result)
	}
	status, result = request(t, client, srv.URL, "POST", "/v1/commerce/bootstrap", initial)
	if status != 200 || result["replayed"] != true {
		t.Fatalf("safe bootstrap replay: %d %#v", status, result)
	}
	altered := commerceFixture()
	altered["legacyExtension"] = "other"
	status, _ = request(t, client, srv.URL, "POST", "/v1/commerce/bootstrap", map[string]any{"storeId": storeID, "sourceHash": hash, "snapshot": altered})
	if status != 409 {
		t.Fatalf("bootstrap cannot overwrite an existing snapshot: %d", status)
	}
	status, result = request(t, client, srv.URL, "GET", "/v1/commerce", nil)
	got := result["snapshot"].(map[string]any)
	if status != 200 || got["legacyExtension"] != "kept" || got["counters"].(map[string]any)["legacyCounter"] != float64(9) {
		t.Fatalf("snapshot preservation: %d %#v", status, result)
	}

	// Competing writers based on one revision cannot overwrite one another.
	const writers = 12
	codes := make(chan int, writers)
	var wg sync.WaitGroup
	for i := 0; i < writers; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			item := commerceFixture()
			item["legacyExtension"] = fmt.Sprintf("writer-%d", n)
			body, _ := json.Marshal(map[string]any{"storeId": storeID, "expectedRevision": 0, "snapshot": item})
			r, _ := http.NewRequest("PUT", srv.URL+"/v1/commerce", bytes.NewReader(body))
			r.Header.Set("Authorization", "Bearer "+testToken)
			r.Header.Set("Content-Type", "application/json")
			res, err := client.Do(r)
			if err != nil {
				codes <- 0
				return
			}
			res.Body.Close()
			codes <- res.StatusCode
		}(i)
	}
	wg.Wait()
	close(codes)
	var successes, conflicts int
	for code := range codes {
		switch code {
		case 200:
			successes++
		case 409:
			conflicts++
		default:
			t.Fatalf("unexpected concurrent update status: %d", code)
		}
	}
	if successes != 1 || conflicts != writers-1 {
		t.Fatalf("CAS successes=%d conflicts=%d", successes, conflicts)
	}
	status, result = request(t, client, srv.URL, "GET", "/v1/commerce", nil)
	if status != 200 || result["revision"] != float64(1) || result["storeId"] != storeID {
		t.Fatalf("persisted revision: %d %#v", status, result)
	}
	status, _ = request(t, client, srv.URL, "POST", "/v1/commerce/bootstrap", initial)
	if status != 409 {
		t.Fatalf("cannot replay after state changed: %d", status)
	}
	status, _ = request(t, client, srv.URL, "PUT", "/v1/commerce", map[string]any{"storeId": strings.Repeat("c", 32), "expectedRevision": 1, "snapshot": fixture})
	if status != 409 {
		t.Fatalf("wrong store identity: %d", status)
	}
}

// Upgrading an existing inquiry database adds commerce without replacing any
// prior tables or records. The helper creates a unique disposable schema.
func TestCommerceMigrationPreservesExistingInquiries(t *testing.T) {
	db := integrationDB(t)
	srv := httptest.NewServer(New(db, testToken))
	defer srv.Close()
	status, _ := request(t, srv.Client(), srv.URL, "POST", "/v1/inquiries", validInput())
	if status != 201 {
		t.Fatalf("create inquiry: %d", status)
	}
	if _, err := db.Exec(`DROP TABLE novex_builder_state; DROP TABLE novex_commerce_state; DELETE FROM novex_schema_migrations WHERE version >= 3`); err != nil {
		t.Fatal(err)
	}
	if err := Migrate(context.Background(), db); err != nil {
		t.Fatalf("upgrade: %v", err)
	}
	status, result := request(t, srv.Client(), srv.URL, "GET", "/v1/inquiries", nil)
	if status != 200 || len(result["items"].([]any)) != 1 {
		t.Fatalf("inquiry lost during upgrade: %d %#v", status, result)
	}
	status, _ = request(t, srv.Client(), srv.URL, "GET", "/v1/commerce", nil)
	if status != 404 {
		t.Fatalf("commerce initialized unexpectedly: %d", status)
	}
}
