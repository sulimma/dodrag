package eventstore

import (
	"fmt"
	"strings"
)

// Project state is derived from the same undoable history as task state.
// The task snapshot cache deliberately remains independent of project metadata.
type projectState struct {
	projects map[string]map[string]interface{}
	members  map[[2]string]bool
	notes    map[[2]string]string
}

func replayProjects(events []Event) (*projectState, error) {
	state := &projectState{projects: make(map[string]map[string]interface{}), members: make(map[[2]string]bool), notes: make(map[[2]string]string)}
	for _, event := range events {
		if event.Undone || !strings.HasPrefix(event.Type, "PROJECT_") {
			continue
		}
		p, err := validatePayload(event.Type, event.Payload)
		if err == nil {
			_, err = state.apply(event.Type, p)
		}
		if err != nil {
			return nil, fmt.Errorf("event %d: %w", event.Seq, err)
		}
	}
	return state, nil
}

func (s *projectState) apply(kind string, p map[string]interface{}) (bool, error) {
	id := p["projectId"].(string)
	old := s.projects[id]
	if kind == "PROJECT_SAVED" {
		if old != nil && old["code"] == p["code"] && old["color"] == p["color"] && old["summary"] == p["summary"] && old["description"] == p["description"] {
			return false, nil
		}
		s.projects[id] = p
		return true, nil
	}
	if old == nil {
		return false, fmt.Errorf("unknown project: %s", id)
	}
	if kind == "PROJECT_NOTE_SET" {
		key := [2]string{id, p["entryId"].(string)}
		value := p["text"].(string)
		if s.notes[key] == value {
			return false, nil
		}
		if value == "" {
			delete(s.notes, key)
		} else {
			s.notes[key] = value
		}
		return true, nil
	}
	key := [2]string{id, p["taskId"].(string)}
	assigned := p["assigned"].(bool)
	if s.members[key] == assigned {
		return false, nil
	}
	if assigned {
		s.members[key] = true
	} else {
		delete(s.members, key)
	}
	return true, nil
}

// DeleteProject permanently removes just this project's events, including redo
// history. Mixed batches retain their task events and other project memberships.
func (s *Store) DeleteProject(id string) ([]Event, error) {
	if err := checkID(id); err != nil {
		return nil, err
	}
	if err := s.checkOpen(); err != nil {
		return nil, err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer rollbackCache(tx, s)
	working := *s
	if err := working.ensureCache(tx); err != nil {
		return nil, err
	}
	const predicate = "type IN ('PROJECT_SAVED','PROJECT_NOTE_SET','PROJECT_MEMBER_SET') AND json_extract(payload,'$.projectId')=?"
	if _, err = tx.Exec("DELETE FROM event_snapshots WHERE seq >= (SELECT MIN(seq) FROM events WHERE "+predicate+")", id); err != nil {
		return nil, err
	}
	if _, err = tx.Exec("DELETE FROM events WHERE "+predicate, id); err != nil {
		return nil, err
	}
	working.ready = false
	if err = working.ensureCache(tx); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	*s = working
	return copyEvents(s.events), nil
}
