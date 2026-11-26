package main

import (
	"errors"

	"dodrag/internal/eventstore"
	timemeasurement "dodrag/internal/plugins/time-measurement"
)

func (a *App) checkTimeMeasurementLocked(generation uint64) error {
	if a.store == nil || generation != a.databaseGeneration || a.closeApproved {
		return errors.New(a.textLocked("keine Datenbank geöffnet"))
	}
	if a.settingsLoadErr != nil {
		return a.settingsLoadErr
	}
	if !a.settings.PluginEnabled[timemeasurement.ID] {
		return errors.New(a.textLocked("Zeiterfassung ist nicht aktiviert"))
	}
	return nil
}

func (a *App) timerErrorLocked(key string, err error) error {
	switch {
	case errors.Is(err, timemeasurement.ErrTask):
		key = "Die Aufgabe ist nicht mehr verfügbar oder bereits erledigt"
	case errors.Is(err, timemeasurement.ErrRecovery):
		key = "Die unterbrochene Messung muss zuerst geklärt werden"
	case errors.Is(err, timemeasurement.ErrSession):
		key = "Die Zeiterfassungssitzung ist nicht mehr verfügbar"
	case errors.Is(err, timemeasurement.ErrFutureEnd):
		key = "Die Endzeit liegt in der Zukunft"
	case errors.Is(err, timemeasurement.ErrShortEdit):
		key = "Eine gespeicherte Messung muss mindestens 30 Sekunden lang sein"
	case errors.Is(err, timemeasurement.ErrOverlap):
		key = "Die Messung überschneidet sich mit einer anderen Messung"
	default:
		return a.errorLocked(key, err)
	}
	return errors.New(a.textLocked(key))
}

func (a *App) timerAction(generation uint64, key string, action func(*eventstore.Store) (timemeasurement.State, error)) (timemeasurement.State, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.checkTimeMeasurementLocked(generation); err != nil {
		return timemeasurement.State{}, err
	}
	state, err := action(a.store)
	return state, a.timerErrorLocked(key, err)
}

func (a *App) GetTimeMeasurement(generation uint64) (timemeasurement.State, error) {
	return a.timerAction(generation, "Zeiterfassung konnte nicht geladen werden", (*eventstore.Store).TimeMeasurement)
}

func (a *App) StartTimeMeasurement(generation uint64, taskID, creationEventID string) (timemeasurement.State, error) {
	return a.timerAction(generation, "Zeiterfassung konnte nicht gespeichert werden", func(s *eventstore.Store) (timemeasurement.State, error) {
		return s.StartTimeMeasurement(timemeasurement.TaskIdentity{ID: taskID, CreationEventID: creationEventID})
	})
}

func (a *App) StopTimeMeasurement(generation uint64, id int64) (timemeasurement.State, error) {
	return a.timerAction(generation, "Zeiterfassung konnte nicht gestoppt werden", func(s *eventstore.Store) (timemeasurement.State, error) {
		return s.StopTimeMeasurement(id)
	})
}

func (a *App) UpdateTimeMeasurementEnd(generation uint64, id, endMs int64) (timemeasurement.State, error) {
	return a.timerAction(generation, "Zeiterfassung konnte nicht gespeichert werden", func(s *eventstore.Store) (timemeasurement.State, error) {
		return s.UpdateTimeMeasurementEnd(id, endMs)
	})
}

func (a *App) DeleteTimeMeasurementSession(generation uint64, id int64) (timemeasurement.State, error) {
	return a.timerAction(generation, "Zeiterfassung konnte nicht gespeichert werden", func(s *eventstore.Store) (timemeasurement.State, error) {
		return s.DeleteTimeMeasurementSession(id)
	})
}

func (a *App) RecoverTimeMeasurement(generation uint64, id, endMs int64, discard bool) (timemeasurement.State, error) {
	return a.timerAction(generation, "Zeiterfassung konnte nicht gespeichert werden", func(s *eventstore.Store) (timemeasurement.State, error) {
		return s.RecoverTimeMeasurement(id, endMs, discard)
	})
}

func (a *App) stopOwnedTimeMeasurementLocked() error {
	if a.store == nil {
		return nil
	}
	return a.timerErrorLocked("Zeiterfassung konnte nicht gestoppt werden", a.store.StopOwnedTimeMeasurement())
}
