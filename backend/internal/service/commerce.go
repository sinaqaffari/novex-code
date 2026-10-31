package service

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
)

// Astro retains domain validation. These internal, independently versioned
// snapshots use atomic CAS and are never exposed directly to public browsers.
const maxCommerceBody = 16 << 20
const maxSafeRevision = 9007199254740990

type commerceBootstrap struct {
	StoreID    string          `json:"storeId"`
	SourceHash string          `json:"sourceHash"`
	Snapshot   json.RawMessage `json:"snapshot"`
}

type commerceUpdate struct {
	StoreID          string          `json:"storeId"`
	ExpectedRevision int64           `json:"expectedRevision"`
	Snapshot         json.RawMessage `json:"snapshot"`
}

// Check the common envelope without rejecting legacy extension fields. The
// Astro domain performs its existing more specific normalization on each read.
func validCommerceSnapshot(raw json.RawMessage) bool {
	var fields map[string]json.RawMessage
	if len(raw) == 0 || json.Unmarshal(raw, &fields) != nil || fields == nil {
		return false
	}
	version, ok := fields["version"]
	if !ok || string(version) == "null" {
		return false
	}
	var counters map[string]json.RawMessage
	if json.Unmarshal(fields["counters"], &counters) != nil || counters == nil {
		return false
	}
	if _, ok := counters["order"]; !ok {
		return false
	}
	for _, key := range []string{"products", "orders", "customers", "discounts"} {
		var array []json.RawMessage
		value := fields[key]
		if len(value) == 0 || value[0] != '[' || json.Unmarshal(value, &array) != nil {
			return false
		}
	}
	return true
}

type snapshotSpec struct {
	table string
	valid func(json.RawMessage) bool
}

var commerceSpec = snapshotSpec{table: "novex_commerce_state", valid: validCommerceSnapshot}
var builderSpec = snapshotSpec{table: "novex_builder_state", valid: validBuilderSnapshot}

func validBuilderSnapshot(raw json.RawMessage) bool {
	var fields map[string]json.RawMessage
	if len(raw) == 0 || json.Unmarshal(raw, &fields) != nil || fields == nil || string(fields["schemaVersion"]) != "1" {
		return false
	}
	for _, key := range []string{"pages", "templates", "sections", "declarativePlugins"} {
		value, present := fields[key]
		if !present && key != "pages" {
			continue
		} // legacy optional collections
		var item map[string]json.RawMessage
		if json.Unmarshal(value, &item) != nil || item == nil {
			return false
		}
	}
	return true
}

func (s *server) getCommerce(w http.ResponseWriter, r *http.Request) {
	s.getSnapshot(w, r, commerceSpec)
}
func (s *server) bootstrapCommerce(w http.ResponseWriter, r *http.Request) {
	s.bootstrapSnapshot(w, r, commerceSpec)
}
func (s *server) updateCommerce(w http.ResponseWriter, r *http.Request) {
	s.updateSnapshot(w, r, commerceSpec)
}
func (s *server) getBuilder(w http.ResponseWriter, r *http.Request) { s.getSnapshot(w, r, builderSpec) }
func (s *server) bootstrapBuilder(w http.ResponseWriter, r *http.Request) {
	s.bootstrapSnapshot(w, r, builderSpec)
}
func (s *server) updateBuilder(w http.ResponseWriter, r *http.Request) {
	s.updateSnapshot(w, r, builderSpec)
}

// table comes only from the two static specifications above, never a request.
func (s *server) getSnapshot(w http.ResponseWriter, r *http.Request, spec snapshotSpec) {
	var storeID, sourceHash string
	var revision int64
	var snapshot []byte
	err := s.db.QueryRowContext(r.Context(), `SELECT store_id, source_hash, revision, snapshot FROM `+spec.table+` WHERE id = 1`).Scan(&storeID, &sourceHash, &revision, &snapshot)
	if errors.Is(err, sql.ErrNoRows) {
		reply(w, http.StatusNotFound, map[string]any{"ok": false, "code": "not_initialized"})
		return
	}
	if err != nil {
		reply(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "code": "database_unavailable"})
		return
	}
	reply(w, http.StatusOK, map[string]any{"ok": true, "storeId": storeID, "sourceHash": sourceHash, "revision": revision, "snapshot": json.RawMessage(snapshot)})
}

func (s *server) bootstrapSnapshot(w http.ResponseWriter, r *http.Request, spec snapshotSpec) {
	var input commerceBootstrap
	if !decodeBounded(w, r, &input, maxCommerceBody) {
		return
	}
	if !hex32RE.MatchString(input.StoreID) || !hex64RE.MatchString(input.SourceHash) || !spec.valid(input.Snapshot) {
		reply(w, http.StatusUnprocessableEntity, map[string]any{"ok": false, "code": "invalid_snapshot"})
		return
	}
	var revision int64
	err := s.db.QueryRowContext(r.Context(), `INSERT INTO `+spec.table+` (id, store_id, source_hash, revision, snapshot) VALUES (1, $1, $2, 0, $3::jsonb) ON CONFLICT (id) DO NOTHING RETURNING revision`, input.StoreID, input.SourceHash, string(input.Snapshot)).Scan(&revision)
	if err == nil {
		reply(w, http.StatusCreated, map[string]any{"ok": true, "revision": revision, "replayed": false})
		return
	}
	if !errors.Is(err, sql.ErrNoRows) {
		reply(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "code": "database_unavailable"})
		return
	}
	// A retry after an interrupted bootstrap is safe only for the exact same
	// source, store identity and unchanged initial PostgreSQL snapshot.
	var same bool
	err = s.db.QueryRowContext(r.Context(), `SELECT store_id = $1 AND source_hash = $2 AND revision = 0 AND snapshot = $3::jsonb FROM `+spec.table+` WHERE id = 1`, input.StoreID, input.SourceHash, string(input.Snapshot)).Scan(&same)
	if err != nil {
		reply(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "code": "database_unavailable"})
		return
	}
	if !same {
		reply(w, http.StatusConflict, map[string]any{"ok": false, "code": "already_initialized"})
		return
	}
	reply(w, http.StatusOK, map[string]any{"ok": true, "revision": 0, "replayed": true})
}

func (s *server) updateSnapshot(w http.ResponseWriter, r *http.Request, spec snapshotSpec) {
	var input commerceUpdate
	if !decodeBounded(w, r, &input, maxCommerceBody) {
		return
	}
	if !hex32RE.MatchString(input.StoreID) || input.ExpectedRevision < 0 || input.ExpectedRevision > maxSafeRevision || !spec.valid(input.Snapshot) {
		reply(w, http.StatusUnprocessableEntity, map[string]any{"ok": false, "code": "invalid_snapshot"})
		return
	}
	var revision int64
	err := s.db.QueryRowContext(r.Context(), `UPDATE `+spec.table+` SET snapshot = $1::jsonb, revision = revision + 1, updated_at = now() WHERE id = 1 AND store_id = $2 AND revision = $3 RETURNING revision`, string(input.Snapshot), input.StoreID, input.ExpectedRevision).Scan(&revision)
	if errors.Is(err, sql.ErrNoRows) {
		reply(w, http.StatusConflict, map[string]any{"ok": false, "code": "revision_conflict"})
		return
	}
	if err != nil {
		reply(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "code": "database_unavailable"})
		return
	}
	reply(w, http.StatusOK, map[string]any{"ok": true, "revision": revision})
}
