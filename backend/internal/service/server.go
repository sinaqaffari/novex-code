// Package service implements the authenticated internal API. The Astro server
// owns browser sessions and authorization; this service is never a public API.
package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

var (
	slugRE    = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)
	nodeRE    = regexp.MustCompile(`^node_[A-Za-z0-9_-]{6,80}$`)
	hex32RE   = regexp.MustCompile(`^[a-f0-9]{32}$`)
	hex64RE   = regexp.MustCompile(`^[a-f0-9]{64}$`)
	inquiryRE = regexp.MustCompile(`^inq_[a-f0-9]{32}$`)
)

// Migrate creates only this service's tables and never rewrites existing CMS files.
// An advisory transaction lock serializes migrations from multiple instances.
func Migrate(ctx context.Context, db *sql.DB) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(8246101)`); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS novex_schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`); err != nil {
		return err
	}
	var latest int
	if err = tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(version), 0) FROM novex_schema_migrations`).Scan(&latest); err != nil {
		return err
	}
	if latest > 4 {
		return errors.New("database schema is newer than this backend")
	}
	if latest < 1 {
		_, err = tx.ExecContext(ctx, `
CREATE TABLE novex_inquiries (
 id text PRIMARY KEY, request_id text NOT NULL UNIQUE, fingerprint text NOT NULL,
 page_slug text NOT NULL, node_id text NOT NULL, kind text NOT NULL,
 name text NOT NULL, contact text NOT NULL, message text NOT NULL,
 status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'read', 'archived')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX novex_inquiries_created_idx ON novex_inquiries (created_at DESC, id DESC);
CREATE INDEX novex_inquiries_status_idx ON novex_inquiries (status, created_at DESC);
CREATE TABLE novex_inquiry_rate_limits (
 client_hash text NOT NULL, window_start bigint NOT NULL, hits integer NOT NULL,
 PRIMARY KEY (client_hash, window_start)
);
INSERT INTO novex_schema_migrations(version) VALUES (1)`)
		if err != nil {
			return err
		}
	}
	if latest < 2 {
		if _, err = tx.ExecContext(ctx, `CREATE INDEX novex_inquiry_rate_window_idx ON novex_inquiry_rate_limits (window_start); INSERT INTO novex_schema_migrations(version) VALUES (2)`); err != nil {
			return err
		}
	}
	if latest < 3 {
		if _, err = tx.ExecContext(ctx, `
CREATE TABLE novex_commerce_state (
 id integer PRIMARY KEY CHECK (id = 1),
 store_id text NOT NULL,
 source_hash text NOT NULL,
 revision bigint NOT NULL CHECK (revision >= 0),
 snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO novex_schema_migrations(version) VALUES (3)`); err != nil {
			return err
		}
	}
	if latest < 4 {
		if _, err = tx.ExecContext(ctx, `
CREATE TABLE novex_builder_state (
 id integer PRIMARY KEY CHECK (id = 1),
 store_id text NOT NULL,
 source_hash text NOT NULL,
 revision bigint NOT NULL CHECK (revision >= 0),
 snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO novex_schema_migrations(version) VALUES (4)`); err != nil {
			return err
		}
	}
	return tx.Commit()
}

type InquiryInput struct {
	RequestID  string `json:"requestId"`
	PageSlug   string `json:"pageSlug"`
	NodeID     string `json:"nodeId"`
	Kind       string `json:"kind"`
	Name       string `json:"name"`
	Contact    string `json:"contact"`
	Message    string `json:"message"`
	ClientHash string `json:"clientHash"`
}

type Inquiry struct {
	ID        string    `json:"id"`
	PageSlug  string    `json:"pageSlug"`
	NodeID    string    `json:"nodeId"`
	Kind      string    `json:"kind"`
	Name      string    `json:"name"`
	Contact   string    `json:"contact"`
	Message   string    `json:"message"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type server struct {
	db    *sql.DB
	token string
}

func New(db *sql.DB, token string) http.Handler {
	s := &server{db: db, token: token}
	api := http.NewServeMux()
	api.HandleFunc("POST /v1/inquiries", s.createInquiry)
	api.HandleFunc("GET /v1/inquiries", s.listInquiries)
	api.HandleFunc("PATCH /v1/inquiries/{id}", s.updateInquiry)
	api.HandleFunc("DELETE /v1/inquiries/{id}", s.deleteInquiry)
	api.HandleFunc("GET /v1/commerce", s.getCommerce)
	api.HandleFunc("POST /v1/commerce/bootstrap", s.bootstrapCommerce)
	api.HandleFunc("PUT /v1/commerce", s.updateCommerce)
	api.HandleFunc("GET /v1/builder", s.getBuilder)
	api.HandleFunc("POST /v1/builder/bootstrap", s.bootstrapBuilder)
	api.HandleFunc("PUT /v1/builder", s.updateBuilder)
	root := http.NewServeMux()
	root.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := db.PingContext(ctx); err != nil {
			reply(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "code": "database_unavailable"})
			return
		}
		reply(w, http.StatusOK, map[string]any{"ok": true})
	})
	root.Handle("/v1/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authorization := r.Header.Get("Authorization")
		provided := strings.TrimPrefix(authorization, "Bearer ")
		if !strings.HasPrefix(authorization, "Bearer ") || len(token) < 32 || subtle.ConstantTimeCompare([]byte(provided), []byte(token)) != 1 {
			reply(w, http.StatusUnauthorized, map[string]any{"ok": false, "code": "unauthorized"})
			return
		}
		api.ServeHTTP(w, r)
	}))
	return root
}

func reply(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func decode(w http.ResponseWriter, r *http.Request, value any) bool {
	return decodeBounded(w, r, value, 16384)
}

func decodeBounded(w http.ResponseWriter, r *http.Request, value any, limit int64) bool {
	if !strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "application/json") {
		reply(w, http.StatusUnsupportedMediaType, map[string]any{"ok": false, "code": "unsupported_type"})
		return false
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, limit))
	dec.DisallowUnknownFields()
	if err := dec.Decode(value); err != nil {
		reply(w, http.StatusBadRequest, map[string]any{"ok": false, "code": "invalid_json"})
		return false
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		reply(w, http.StatusBadRequest, map[string]any{"ok": false, "code": "invalid_json"})
		return false
	}
	return true
}

func cleanText(value string, minimum, maximum int, multiline bool) (string, bool) {
	value = strings.TrimSpace(value)
	if !utf8.ValidString(value) || utf8.RuneCountInString(value) < minimum || utf8.RuneCountInString(value) > maximum {
		return "", false
	}
	for _, c := range value {
		if unicode.IsControl(c) && !(multiline && (c == '\n' || c == '\r' || c == '\t')) {
			return "", false
		}
	}
	return value, true
}

func normalizeInput(in *InquiryInput) bool {
	if len(in.PageSlug) > 60 || !slugRE.MatchString(in.PageSlug) || !nodeRE.MatchString(in.NodeID) || !hex32RE.MatchString(in.RequestID) || !hex64RE.MatchString(in.ClientHash) {
		return false
	}
	switch in.Kind {
	case "contact", "reservation", "consultation", "enrollment":
	default:
		return false
	}
	var ok bool
	if in.Name, ok = cleanText(in.Name, 2, 120, false); !ok {
		return false
	}
	if in.Contact, ok = cleanText(in.Contact, 3, 160, false); !ok {
		return false
	}
	if in.Message, ok = cleanText(in.Message, 2, 2000, true); !ok {
		return false
	}
	return true
}

func newID() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return "inq_" + hex.EncodeToString(b[:]), nil
}

func fingerprint(in InquiryInput) string {
	// Client identity is deliberately excluded so retries survive a network change.
	v, _ := json.Marshal([]string{in.PageSlug, in.NodeID, in.Kind, in.Name, in.Contact, in.Message})
	sum := sha256.Sum256(v)
	return hex.EncodeToString(sum[:])
}

func (s *server) createInquiry(w http.ResponseWriter, r *http.Request) {
	var in InquiryInput
	if !decode(w, r, &in) {
		return
	}
	if !normalizeInput(&in) {
		reply(w, http.StatusUnprocessableEntity, map[string]any{"ok": false, "code": "invalid_inquiry"})
		return
	}
	id, err := newID()
	if err != nil {
		reply(w, 503, map[string]any{"ok": false, "code": "unavailable"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		reply(w, 503, map[string]any{"ok": false, "code": "database_unavailable"})
		return
	}
	defer tx.Rollback()
	fp := fingerprint(in)
	var inserted string
	err = tx.QueryRowContext(ctx, `INSERT INTO novex_inquiries(id,request_id,fingerprint,page_slug,node_id,kind,name,contact,message) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(request_id) DO NOTHING RETURNING id`, id, in.RequestID, fp, in.PageSlug, in.NodeID, in.Kind, in.Name, in.Contact, in.Message).Scan(&inserted)
	if errors.Is(err, sql.ErrNoRows) {
		var savedFP string
		if err = tx.QueryRowContext(ctx, `SELECT id, fingerprint FROM novex_inquiries WHERE request_id=$1`, in.RequestID).Scan(&inserted, &savedFP); err != nil {
			reply(w, 503, map[string]any{"ok": false, "code": "database_unavailable"})
			return
		}
		if subtle.ConstantTimeCompare([]byte(savedFP), []byte(fp)) != 1 {
			reply(w, 409, map[string]any{"ok": false, "code": "idempotency_conflict"})
			return
		}
		if err = tx.Commit(); err != nil {
			reply(w, 503, map[string]any{"ok": false, "code": "database_unavailable"})
			return
		}
		reply(w, 200, map[string]any{"ok": true, "id": inserted, "replayed": true})
		return
	}
	if err != nil {
		reply(w, 503, map[string]any{"ok": false, "code": "database_unavailable"})
		return
	}
	// An atomic PostgreSQL counter coordinates multiple backend instances. Only a
	// salted digest of the peer address is retained, never the address itself.
	window := time.Now().Unix() / 600
	var hits int
	err = tx.QueryRowContext(ctx, `INSERT INTO novex_inquiry_rate_limits(client_hash,window_start,hits) VALUES($1,$2,1) ON CONFLICT(client_hash,window_start) DO UPDATE SET hits=novex_inquiry_rate_limits.hits+1 WHERE novex_inquiry_rate_limits.hits < 20 RETURNING hits`, in.ClientHash, window).Scan(&hits)
	if errors.Is(err, sql.ErrNoRows) {
		reply(w, 429, map[string]any{"ok": false, "code": "rate_limited"})
		return
	}
	if err != nil {
		reply(w, 503, map[string]any{"ok": false, "code": "database_unavailable"})
		return
	}
	if hits == 1 {
		_, _ = tx.ExecContext(ctx, `DELETE FROM novex_inquiry_rate_limits WHERE window_start < $1`, window-2)
	}
	if err = tx.Commit(); err != nil {
		reply(w, 503, map[string]any{"ok": false, "code": "database_unavailable"})
		return
	}
	reply(w, 201, map[string]any{"ok": true, "id": inserted, "replayed": false})
}

func (s *server) listInquiries(w http.ResponseWriter, r *http.Request) {
	limit := 50
	offset := 0
	if raw := r.URL.Query().Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > 100 {
			reply(w, 400, map[string]any{"ok": false, "code": "invalid_pagination"})
			return
		}
		limit = n
	}
	if raw := r.URL.Query().Get("offset"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 0 || n > 100000 {
			reply(w, 400, map[string]any{"ok": false, "code": "invalid_pagination"})
			return
		}
		offset = n
	}
	status := r.URL.Query().Get("status")
	if status != "" && status != "new" && status != "read" && status != "archived" {
		reply(w, 400, map[string]any{"ok": false, "code": "invalid_status"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	rows, err := s.db.QueryContext(ctx, `SELECT id,page_slug,node_id,kind,name,contact,message,status,created_at,updated_at FROM novex_inquiries WHERE ($1='' OR status=$1) ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3`, status, limit+1, offset)
	if err != nil {
		reply(w, 503, map[string]any{"ok": false, "code": "database_unavailable"})
		return
	}
	defer rows.Close()
	out := make([]Inquiry, 0, limit+1)
	for rows.Next() {
		var item Inquiry
		if err := rows.Scan(&item.ID, &item.PageSlug, &item.NodeID, &item.Kind, &item.Name, &item.Contact, &item.Message, &item.Status, &item.CreatedAt, &item.UpdatedAt); err != nil {
			reply(w, 503, map[string]any{"ok": false, "code": "database_unavailable"})
			return
		}
		out = append(out, item)
	}
	if rows.Err() != nil {
		reply(w, 503, map[string]any{"ok": false, "code": "database_unavailable"})
		return
	}
	more := len(out) > limit
	if more {
		out = out[:limit]
	}
	reply(w, 200, map[string]any{"ok": true, "items": out, "hasMore": more})
}

func (s *server) updateInquiry(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !inquiryRE.MatchString(id) {
		reply(w, 400, map[string]any{"ok": false, "code": "invalid_id"})
		return
	}
	var in struct {
		Status string `json:"status"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.Status != "new" && in.Status != "read" && in.Status != "archived" {
		reply(w, 422, map[string]any{"ok": false, "code": "invalid_status"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	result, err := s.db.ExecContext(ctx, `UPDATE novex_inquiries SET status=$1,updated_at=now() WHERE id=$2`, in.Status, id)
	if err != nil {
		reply(w, 503, map[string]any{"ok": false, "code": "database_unavailable"})
		return
	}
	n, err := result.RowsAffected()
	if err != nil {
		reply(w, 503, map[string]any{"ok": false, "code": "database_unavailable"})
		return
	}
	if n == 0 {
		reply(w, 404, map[string]any{"ok": false, "code": "not_found"})
		return
	}
	reply(w, 200, map[string]any{"ok": true})
}

func (s *server) deleteInquiry(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !inquiryRE.MatchString(id) {
		reply(w, 400, map[string]any{"ok": false, "code": "invalid_id"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	result, err := s.db.ExecContext(ctx, `DELETE FROM novex_inquiries WHERE id=$1`, id)
	if err != nil {
		reply(w, 503, map[string]any{"ok": false, "code": "database_unavailable"})
		return
	}
	n, err := result.RowsAffected()
	if err != nil {
		reply(w, 503, map[string]any{"ok": false, "code": "database_unavailable"})
		return
	}
	if n == 0 {
		reply(w, 404, map[string]any{"ok": false, "code": "not_found"})
		return
	}
	reply(w, 200, map[string]any{"ok": true})
}
