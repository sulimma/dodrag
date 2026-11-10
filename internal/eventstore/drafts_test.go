package eventstore

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func draftStore(t *testing.T, path string) *Store {
	t.Helper()
	s, err := NewStoreWithOptions(path, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(s.events) == 0 {
		_, err = s.AppendEvent("create", "TASK_CREATED", `{"taskId":"a","title":"A","configuredStart":"2026-11-10T09:00:00Z","createdAt":"2026-11-10T09:00:00Z"}`)
		if err != nil {
			t.Fatal(err)
		}
	}
	return s
}
func checkpoint(t *testing.T, s *Store, text, base string, revision int64) {
	t.Helper()
	if err := s.SaveDescriptionDraft("a", text, base, "session", revision); err != nil {
		t.Fatal(err)
	}
}
func draftCount(t *testing.T, s *Store) int {
	t.Helper()
	var n int
	if err := s.db.QueryRow(`SELECT count(*) FROM description_drafts`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}
func TestDescriptionDraftSurvivesProcessExit(t *testing.T) {
	if path := os.Getenv("DODRAG_DRAFT_CRASH_TEST"); path != "" {
		s := draftStore(t, path)
		checkpoint(t, s, "Recovered typing", "", 1)
		// Deliberately omit Store.Close and every deferred cleanup, as on process loss.
		os.Exit(0)
	}
	path := filepath.Join(t.TempDir(), "draft.db")
	cmd := exec.Command(os.Args[0], "-test.run=^TestDescriptionDraftSurvivesProcessExit$")
	cmd.Env = append(os.Environ(), "DODRAG_DRAFT_CRASH_TEST="+path)
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("child: %v %s", err, output)
	}
	s := draftStore(t, path)
	defer s.Close()
	if s.tasks["a"].description != "Recovered typing" || draftCount(t, s) != 0 || len(s.events) != 2 {
		t.Fatal("checkpoint not recovered exactly once")
	}
	if _, err := s.Undo(); err != nil {
		t.Fatal(err)
	}
	if s.tasks["a"].description != "" {
		t.Fatal("recovered edit must be undoable")
	}
}
func TestDescriptionDraftBoundedAndRevisionGuard(t *testing.T) {
	s := draftStore(t, filepath.Join(t.TempDir(), "draft.db"))
	defer s.Close()
	for i := int64(1); i <= 100; i++ {
		checkpoint(t, s, "Newest", "", i)
	}
	checkpoint(t, s, "Obsolete", "", 1)
	if draftCount(t, s) != 1 || len(s.events) != 1 {
		t.Fatal("typing grew event history")
	}
	if err := s.SaveDescriptionDraft("a", "Other", "", "other", 1); err == nil {
		t.Fatal("another session overwrote draft")
	}
	if err := s.RecoverDescriptionDrafts(); err != nil {
		t.Fatal(err)
	}
	if s.tasks["a"].description != "Newest" {
		t.Fatal("late revision replaced latest")
	}
}
func TestDescriptionDraftAtomicFinalization(t *testing.T) {
	s := draftStore(t, filepath.Join(t.TempDir(), "draft.db"))
	defer s.Close()
	checkpoint(t, s, "Final", "", 1)
	if _, err := s.db.Exec(`CREATE TRIGGER fail_draft_commit BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT,'simulated disk failure'); END`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.AppendEvent("final", "TASK_DESCRIPTION_SET", `{"taskId":"a","description":"Final"}`); err == nil {
		t.Fatal("expected rejection")
	}
	if draftCount(t, s) != 1 {
		t.Fatal("failed final save consumed recovery data")
	}
	if _, err := s.db.Exec(`DROP TRIGGER fail_draft_commit`); err != nil {
		t.Fatal(err)
	}
	if err := s.RecoverDescriptionDrafts(); err != nil {
		t.Fatal(err)
	}
	if s.tasks["a"].description != "Final" || draftCount(t, s) != 0 {
		t.Fatal("retry failed")
	}
}
func TestDescriptionDraftNewerCheckpointAndNoop(t *testing.T) {
	s := draftStore(t, filepath.Join(t.TempDir(), "draft.db"))
	defer s.Close()
	checkpoint(t, s, "Newer", "", 2)
	if _, err := s.AppendEvent("older", "TASK_DESCRIPTION_SET", `{"taskId":"a","description":"Older"}`); err != nil {
		t.Fatal(err)
	}
	if draftCount(t, s) != 1 {
		t.Fatal("older acknowledgement erased newer checkpoint")
	}
	if err := s.RecoverDescriptionDrafts(); err != nil {
		t.Fatal(err)
	}
	if s.tasks["a"].description != "Newer" {
		t.Fatal("newer checkpoint not recovered")
	}
	checkpoint(t, s, "Newer", "Newer", 3)
	before := len(s.events)
	if _, err := s.AppendEvent("noop", "TASK_DESCRIPTION_SET", `{"taskId":"a","description":"Newer"}`); err != nil {
		t.Fatal(err)
	}
	if draftCount(t, s) != 0 || len(s.events) != before {
		t.Fatal("no-op did not consume checkpoint cleanly")
	}
}
func TestDescriptionDraftRejectsStaleBase(t *testing.T) {
	s := draftStore(t, filepath.Join(t.TempDir(), "draft.db"))
	defer s.Close()
	checkpoint(t, s, "Keep me", "", 1)
	if err := s.SaveDescriptionDraft("a", "Wrong", "stale", "session", 2); err == nil {
		t.Fatal("stale editor accepted")
	}
	if err := s.RecoverDescriptionDrafts(); err != nil {
		t.Fatal(err)
	}
	if s.tasks["a"].description != "Keep me" {
		t.Fatal("failed checkpoint damaged prior recovery data")
	}
}

func TestDescriptionDraftRecoveryConflictRetainsCheckpoint(t *testing.T) {
	s := draftStore(t, filepath.Join(t.TempDir(), "draft.db"))
	defer s.Close()
	checkpoint(t, s, "Important draft", "", 1)
	// Simulate another writer changing history without advancing the checkpoint.
	if _, err := s.db.Exec(`INSERT INTO events(id,timestamp,type,payload,undone,group_id) VALUES('external','2026-11-10T10:00:00Z','TASK_DESCRIPTION_SET','{"taskId":"a","description":"External change"}',0,'')`); err != nil {
		t.Fatal(err)
	}
	if err := s.RecoverDescriptionDrafts(); err == nil {
		t.Fatal("recovery overwrote concurrent description")
	}
	if draftCount(t, s) != 1 {
		t.Fatal("conflicting recovery data deleted")
	}
	events, err := s.GetEvents()
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 2 || s.tasks["a"].description != "External change" {
		t.Fatal("conflicting recovery modified history")
	}
}

func TestDescriptionDraftFailedCheckpointPreservesLastAcknowledgedText(t *testing.T) {
	s := draftStore(t, filepath.Join(t.TempDir(), "draft.db"))
	defer s.Close()
	checkpoint(t, s, "Acknowledged", "", 1)
	if _, err := s.db.Exec(`CREATE TRIGGER fail_checkpoint BEFORE UPDATE ON description_drafts BEGIN SELECT RAISE(ABORT,'disk unavailable'); END`); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveDescriptionDraft("a", "Not acknowledged", "", "session", 2); err == nil {
		t.Fatal("write failure reported as success")
	}
	if _, err := s.db.Exec(`DROP TRIGGER fail_checkpoint`); err != nil {
		t.Fatal(err)
	}
	if err := s.RecoverDescriptionDrafts(); err != nil {
		t.Fatal(err)
	}
	if s.tasks["a"].description != "Acknowledged" {
		t.Fatal("failed checkpoint destroyed last committed text")
	}
}
