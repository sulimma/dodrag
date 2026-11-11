package eventstore

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"time"
)

// Timeline constraints have no task duration, completion or graph edges. Keep
// their validation separate from the task snapshot cache. Timeline edits replay
// their small state from the authoritative log (the transport already sends the
// full history); snapshots must never become a second source of marker truth.
type timeMarker struct {
	date    string
	minute  int
	removed bool
}
type timelineState struct {
	days     map[string]bool
	markers  map[string]timeMarker
	tasks    map[string]bool
	bindings map[string]string
}

func newTimeline() *timelineState {
	return &timelineState{map[string]bool{}, map[string]timeMarker{}, map[string]bool{}, map[string]string{}}
}
func isTimelineType(kind string) bool {
	switch kind {
	case "TIME_DAY_INITIALIZED", "TIME_MARKER_CREATED", "TIME_MARKER_SET", "TIME_MARKER_REMOVED", "TASK_TIME_MARKER_SET":
		return true
	}
	return false
}
func validMinute(value interface{}) (int, bool) {
	n, ok := value.(float64)
	return int(n), ok && !math.IsNaN(n) && !math.IsInf(n, 0) && n == math.Trunc(n) && n >= 0 && n < 1440
}
func validateTimelinePayload(kind string, raw []byte) (map[string]interface{}, error) {
	var p map[string]interface{}
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, err
	}
	fields := []string{}
	switch kind {
	case "TIME_DAY_INITIALIZED":
		fields = []string{"dateKey", "minutes"}
	case "TIME_MARKER_CREATED":
		fields = []string{"markerId", "dateKey", "minute"}
	case "TIME_MARKER_SET":
		fields = []string{"markerId", "minute"}
	case "TIME_MARKER_REMOVED":
		fields = []string{"markerId"}
	case "TASK_TIME_MARKER_SET":
		fields = []string{"taskId", "markerId"}
	}
	if len(p) != len(fields) {
		return nil, fmt.Errorf("unexpected payload fields for %s", kind)
	}
	for _, field := range fields {
		value, exists := p[field]
		if !exists {
			return nil, fmt.Errorf("missing %s", field)
		}
		switch field {
		case "taskId", "markerId":
			if field == "markerId" && kind == "TASK_TIME_MARKER_SET" && value == nil {
				continue
			}
			id, ok := value.(string)
			if !ok {
				return nil, fmt.Errorf("invalid %s", field)
			}
			if err := checkID(id); err != nil {
				return nil, err
			}
		case "dateKey":
			date, ok := value.(string)
			if !ok {
				return nil, fmt.Errorf("invalid marker date")
			}
			parsed, err := time.Parse("2006-01-02", date)
			if err != nil || parsed.Format("2006-01-02") != date {
				return nil, fmt.Errorf("invalid marker date")
			}
		case "minute":
			if _, ok := validMinute(value); !ok {
				return nil, fmt.Errorf("invalid marker time")
			}
		case "minutes":
			values, ok := value.([]interface{})
			if !ok || len(values) > 96 {
				return nil, fmt.Errorf("invalid marker times")
			}
			previous := -1
			for _, item := range values {
				minute, ok := validMinute(item)
				if !ok || minute <= previous {
					return nil, fmt.Errorf("marker times must be unique and sorted")
				}
				previous = minute
			}
		}
	}
	return p, nil
}
func (s *timelineState) apply(kind string, p map[string]interface{}) (bool, error) {
	switch kind {
	case "TASK_CREATED":
		s.tasks[p["taskId"].(string)] = true
	case "TASK_START_DATE_SET":
		delete(s.bindings, p["taskId"].(string))
	case "TIME_DAY_INITIALIZED":
		date := p["dateKey"].(string)
		if s.days[date] {
			return false, nil
		}
		s.days[date] = true
		for _, item := range p["minutes"].([]interface{}) {
			minute, _ := validMinute(item)
			id := fmt.Sprintf("default-%s-%d", date, minute)
			if _, exists := s.markers[id]; exists {
				return false, fmt.Errorf("duplicate time marker")
			}
			s.markers[id] = timeMarker{date, minute, false}
		}
		return true, nil
	case "TIME_MARKER_CREATED":
		id, date := p["markerId"].(string), p["dateKey"].(string)
		minute, _ := validMinute(p["minute"])
		if _, exists := s.markers[id]; exists {
			return false, fmt.Errorf("duplicate time marker")
		}
		for _, marker := range s.markers {
			if !marker.removed && marker.date == date && marker.minute == minute {
				return false, fmt.Errorf("duplicate time marker")
			}
		}
		s.markers[id] = timeMarker{date, minute, false}
		return true, nil
	case "TIME_MARKER_SET":
		id := p["markerId"].(string)
		marker, exists := s.markers[id]
		if !exists || marker.removed {
			return false, fmt.Errorf("unknown time marker")
		}
		next, _ := validMinute(p["minute"])
		for otherID, other := range s.markers {
			if otherID == id || other.removed || other.date != marker.date {
				continue
			}
			if other.minute < marker.minute && next <= other.minute || other.minute > marker.minute && next >= other.minute {
				return false, fmt.Errorf("time markers cannot cross")
			}
		}
		if marker.minute == next {
			return false, nil
		}
		marker.minute = next
		s.markers[id] = marker
		return true, nil
	case "TIME_MARKER_REMOVED":
		id := p["markerId"].(string)
		marker, exists := s.markers[id]
		if !exists {
			return false, fmt.Errorf("unknown time marker")
		}
		if marker.removed {
			return false, nil
		}
		marker.removed = true
		s.markers[id] = marker
		return true, nil
	case "TASK_TIME_MARKER_SET":
		id := p["taskId"].(string)
		if !s.tasks[id] {
			return false, fmt.Errorf("unknown task: %s", id)
		}
		markerID, _ := p["markerId"].(string)
		if markerID != "" {
			marker, exists := s.markers[markerID]
			if !exists || marker.removed {
				return false, fmt.Errorf("unknown time marker")
			}
		}
		if s.bindings[id] == markerID {
			return false, nil
		}
		if markerID == "" {
			delete(s.bindings, id)
		} else {
			s.bindings[id] = markerID
		}
		return true, nil
	}
	return false, nil
}
func replayTimeline(events []Event) (*timelineState, error) {
	state := newTimeline()
	for _, event := range events {
		if event.Undone {
			continue
		}
		if !isTimelineType(event.Type) && event.Type != "TASK_CREATED" && event.Type != "TASK_START_DATE_SET" {
			continue
		}
		p, err := validatePayload(event.Type, event.Payload)
		if err != nil {
			return nil, err
		}
		if _, err := state.apply(event.Type, p); err != nil {
			return nil, fmt.Errorf("event %d: %w", event.Seq, err)
		}
	}
	return state, nil
}

// Used by native settings too; a detached canonical copy prevents aliasing.
func NormalizeMarkerMinutes(values []int) ([]int, error) {
	if len(values) > 96 {
		return nil, fmt.Errorf("too many marker times")
	}
	result := append([]int{}, values...)
	sort.Ints(result)
	for index, value := range result {
		if value < 0 || value >= 1440 || index > 0 && value == result[index-1] {
			return nil, fmt.Errorf("invalid marker times")
		}
	}
	return result, nil
}
