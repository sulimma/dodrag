package eventstore

import (
	"encoding/json"
	"fmt"
	"time"
)

// Durable editing checkpoints are separate from undo history. The host serializes
// calls; revision guards also reject late checkpoints within a frontend session.
// FULL sync makes acknowledgement mean a committed WAL write, not just RAM.
func (s *Store) initDescriptionDrafts() error {
	_, err := s.db.Exec(`CREATE TABLE IF NOT EXISTS description_drafts (
 task_id TEXT PRIMARY KEY, description TEXT NOT NULL, base_description TEXT NOT NULL,
 session TEXT NOT NULL, revision INTEGER NOT NULL)`)
	return err
}

func (s *Store) SaveDescriptionDraft(taskID, description, base, session string, revision int64) error {
	if err := s.checkOpen(); err != nil {
		return err
	}
	if session == "" || len(session) > 256 || revision < 1 || revision > 9007199254740991 {
		return fmt.Errorf("invalid draft revision")
	}
	payload, _ := json.Marshal(map[string]string{"taskId": taskID, "description": description})
	if _, err := validatePayload("TASK_DESCRIPTION_SET", payload); err != nil {
		return err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer rollbackCache(tx, s)
	if err := s.ensureCache(tx); err != nil {
		return err
	}
	task := s.tasks[taskID]
	if task == nil || task.description != base {
		return fmt.Errorf("description changed since this editor loaded; draft not overwritten")
	}
	var owner string
	var previous int64
	rows, err := tx.Query(`SELECT session, revision FROM description_drafts WHERE task_id=?`, taskID)
	if err != nil {
		return err
	}
	exists := rows.Next()
	if exists {
		err = rows.Scan(&owner, &previous)
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		return err
	}
	if exists && owner != session {
		return fmt.Errorf("description draft belongs to another editing session")
	}
	if exists && revision <= previous {
		return nil
	}
	_, err = tx.Exec(`INSERT INTO description_drafts(task_id,description,base_description,session,revision) VALUES(?,?,?,?,?)
 ON CONFLICT(task_id) DO UPDATE SET description=excluded.description, base_description=excluded.base_description, revision=excluded.revision`, taskID, description, base, session, revision)
	if err != nil {
		return err
	}
	stamp, err := readChangeStamp(tx)
	if err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		s.ready = false
		return err
	}
	s.stamp = stamp
	return nil
}

// On reopening, recover all checkpoints into ordinary events before exposing any
// editable state. AppendBatch consumes them in the same transaction as its events.
// A divergent baseline blocks recovery rather than silently replacing other work.
func (s *Store) RecoverDescriptionDrafts() error {
	if err := s.checkOpen(); err != nil {
		return err
	}
	rows, err := s.db.Query(`SELECT task_id,description,base_description FROM description_drafts ORDER BY task_id`)
	if err != nil {
		return err
	}
	commands := []Command{}
	bases := map[string]string{}
	for rows.Next() {
		var id, text, base string
		if err := rows.Scan(&id, &text, &base); err != nil {
			rows.Close()
			return err
		}
		task := s.tasks[id]
		if task == nil || (task.description != base && task.description != text) {
			rows.Close()
			return fmt.Errorf("conflicting saved description draft for %s; recovery stopped without deleting it", id)
		}
		bases[id] = base
		payload, _ := json.Marshal(map[string]string{"taskId": id, "description": text})
		commands = append(commands, Command{ID: fmt.Sprintf("recovered-%d-%d", time.Now().UnixNano(), len(commands)), Type: "TASK_DESCRIPTION_SET", Payload: payload})
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	if len(commands) == 0 {
		return nil
	}
	_, err = s.appendBatch(commands, bases)
	return err
}
