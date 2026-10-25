package eventstore

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"testing"
)

func benchmarkFixture(b *testing.B, snapshots bool) (string, *Store) {
	b.Helper()
	path := filepath.Join(b.TempDir(), "benchmark.db")
	s, err := NewStoreWithOptions(path, false)
	if err != nil {
		b.Fatal(err)
	}
	b.Cleanup(func() { s.Close() })
	s.skipSnapshots = !snapshots
	if _, err := s.AppendBatch(performanceCommands(10000)); err != nil {
		b.Fatal(err)
	}
	if _, err := s.db.Exec(`UPDATE events SET group_id='edit-' || id`); err != nil {
		b.Fatal(err)
	}
	if _, err := s.GetEvents(); err != nil {
		b.Fatal(err)
	}
	if !snapshots {
		assertNoBenchmarkSnapshots(b, s)
	}
	return path, s
}

func assertNoBenchmarkSnapshots(b *testing.B, s *Store) {
	b.Helper()
	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM event_snapshots`).Scan(&count); err != nil {
		b.Fatal(err)
	}
	if count != 0 || len(s.snapshots) != 0 {
		b.Fatal("no-snapshots benchmark created checkpoints")
	}
}

// Includes full defensive Event/Payload return copies: the unchanged public API
// remains O(E + payload bytes), even when validation and application are incremental.
func BenchmarkAppendBatch10K(b *testing.B) {
	for _, snapshots := range []bool{false, true} {
		b.Run(fmt.Sprintf("snapshots=%v", snapshots), func(b *testing.B) {
			_, s := benchmarkFixture(b, snapshots)
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				_, err := s.AppendBatch([]Command{{ID: fmt.Sprintf("append%d", i), Type: "TASK_DESCRIPTION_SET", GroupID: "typing", Payload: json.RawMessage(fmt.Sprintf(`{"taskId":"t0","description":"benchmark edit %d"}`, i))}})
				if err != nil {
					b.Fatal(err)
				}
			}
			b.StopTimer()
			if !snapshots {
				assertNoBenchmarkSnapshots(b, s)
			}
		})
	}
}

func BenchmarkUndoRedo10K(b *testing.B) {
	for _, snapshots := range []bool{false, true} {
		b.Run(fmt.Sprintf("snapshots=%v", snapshots), func(b *testing.B) {
			_, s := benchmarkFixture(b, snapshots)
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				if _, err := s.Undo(); err != nil {
					b.Fatal(err)
				}
				if _, err := s.Redo(); err != nil {
					b.Fatal(err)
				}
			}
			b.StopTimer()
			if !snapshots {
				assertNoBenchmarkSnapshots(b, s)
			}
		})
	}
}

// Cold opens intentionally fully verify authoritative events and snapshot prefixes.
// Comparing both cases makes that security/performance trade-off visible.
func BenchmarkOpen10K(b *testing.B) {
	for _, snapshots := range []bool{false, true} {
		b.Run(fmt.Sprintf("snapshots=%v", snapshots), func(b *testing.B) {
			path, s := benchmarkFixture(b, snapshots)
			if err := s.Close(); err != nil {
				b.Fatal(err)
			}
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				opened, err := NewStoreWithOptions(path, false)
				if err != nil {
					b.Fatal(err)
				}
				if err := opened.Close(); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}
