package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestBuilderRoutesRequireAuthentication(t *testing.T) {
	h := New(nil, testToken)
	for _, route := range []struct{ method, path string }{
		{http.MethodGet, "/v1/builder"},
		{http.MethodPost, "/v1/builder/bootstrap"},
		{http.MethodPut, "/v1/builder"},
	} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(route.method, route.path, nil))
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("%s %s: %d", route.method, route.path, w.Code)
		}
	}
}

func TestPostgresBuilderSnapshotsAreIndependent(t *testing.T) {
	db := integrationDB(t)
	srv := httptest.NewServer(New(db, testToken))
	defer srv.Close()
	client := srv.Client()
	status, _ := request(t, client, srv.URL, "GET", "/v1/builder", nil)
	if status != 404 {
		t.Fatalf("builder unexpectedly initialized: %d", status)
	}
	id, hash := strings.Repeat("a", 32), strings.Repeat("b", 64)
	fixture := map[string]any{"schemaVersion": 1, "pages": map[string]any{"example": map[string]any{"revision": 4}}, "legacyExtension": "keep"}
	bad := map[string]any{"storeId": id, "sourceHash": hash, "snapshot": map[string]any{"schemaVersion": 99, "pages": map[string]any{}}}
	status, _ = request(t, client, srv.URL, "POST", "/v1/builder/bootstrap", bad)
	if status != 422 {
		t.Fatalf("accepted future builder schema: %d", status)
	}
	bootstrap := map[string]any{"storeId": id, "sourceHash": hash, "snapshot": fixture}
	status, _ = request(t, client, srv.URL, "POST", "/v1/builder/bootstrap", bootstrap)
	if status != 201 {
		t.Fatalf("builder bootstrap: %d", status)
	}
	status, result := request(t, client, srv.URL, "POST", "/v1/builder/bootstrap", bootstrap)
	if status != 200 || result["replayed"] != true {
		t.Fatalf("builder bootstrap retry: %d %#v", status, result)
	}
	status, _ = request(t, client, srv.URL, "GET", "/v1/commerce", nil)
	if status != 404 {
		t.Fatalf("builder initialized commerce: %d", status)
	}
	changed := map[string]any{"schemaVersion": 1, "pages": map[string]any{"example": map[string]any{"revision": 5}}, "templates": map[string]any{}, "legacyExtension": "keep"}
	update := map[string]any{"storeId": id, "expectedRevision": 0, "snapshot": changed}
	status, _ = request(t, client, srv.URL, "PUT", "/v1/builder", update)
	if status != 200 {
		t.Fatalf("builder update: %d", status)
	}
	status, _ = request(t, client, srv.URL, "PUT", "/v1/builder", update)
	if status != 409 {
		t.Fatalf("stale builder update: %d", status)
	}
	status, _ = request(t, client, srv.URL, "POST", "/v1/builder/bootstrap", bootstrap)
	if status != 409 {
		t.Fatalf("bootstrap overwrote a changed builder: %d", status)
	}
	status, result = request(t, client, srv.URL, "GET", "/v1/builder", nil)
	if status != 200 || result["revision"] != float64(1) || result["snapshot"].(map[string]any)["legacyExtension"] != "keep" {
		t.Fatalf("builder snapshot lost data: %d %#v", status, result)
	}
}

func TestBuilderUpgradePreservesCommerceAndInquiries(t *testing.T) {
	db := integrationDB(t)
	srv := httptest.NewServer(New(db, testToken))
	defer srv.Close()
	client := srv.Client()
	status, _ := request(t, client, srv.URL, "POST", "/v1/inquiries", validInput())
	if status != 201 {
		t.Fatalf("inquiry: %d", status)
	}
	bootstrap := map[string]any{"storeId": strings.Repeat("c", 32), "sourceHash": strings.Repeat("d", 64), "snapshot": commerceFixture()}
	status, _ = request(t, client, srv.URL, "POST", "/v1/commerce/bootstrap", bootstrap)
	if status != 201 {
		t.Fatalf("commerce: %d", status)
	}
	if _, err := db.Exec(`DROP TABLE novex_builder_state; DELETE FROM novex_schema_migrations WHERE version = 4`); err != nil {
		t.Fatal(err)
	}
	if err := Migrate(context.Background(), db); err != nil {
		t.Fatalf("builder migration: %v", err)
	}
	status, commerce := request(t, client, srv.URL, "GET", "/v1/commerce", nil)
	if status != 200 || commerce["snapshot"].(map[string]any)["legacyExtension"] != "kept" {
		t.Fatalf("commerce not preserved: %d %#v", status, commerce)
	}
	status, inquiries := request(t, client, srv.URL, "GET", "/v1/inquiries", nil)
	if status != 200 || len(inquiries["items"].([]any)) != 1 {
		t.Fatalf("inquiry not preserved: %d %#v", status, inquiries)
	}
	status, _ = request(t, client, srv.URL, "GET", "/v1/builder", nil)
	if status != 404 {
		t.Fatalf("builder initialized unexpectedly: %d", status)
	}
}
