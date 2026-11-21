package eventstore

import (
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// MinimumAppVersion is the first app version that understands the format this
// code writes. Bump it for data-format changes, never for UI/bugfix-only changes.
// Release x.y.z: format changes increment y (reset z); other changes increment z.
// Only the developer decides changes to x. The rc suffix is irrelevant here.
const MinimumAppVersion = "0.8.0"

// Keep this historical fallback fixed, even when MinimumAppVersion advances.
const UnversionedMinimumAppVersion = "0.5.0"

// BuildInfo records the last app that successfully opened this database, not
// the time of opening. Release builds supply their injected version/build time;
// local builds without ldflags remain explicitly marked dev with no build time.
type BuildInfo struct {
	Version   string
	BuildTime string
}

// CompatibilityError lets the native UI give a localized upgrade instruction.
// Err retains the original schema/event-validation failure for diagnostics.
type CompatibilityError struct {
	MinimumVersion string
	Err            error
}

func (e *CompatibilityError) Error() string {
	message := fmt.Sprintf("database requires DoDrag %s or newer", e.MinimumVersion)
	if e.Err != nil {
		message += ": " + e.Err.Error()
	}
	return message
}

func (e *CompatibilityError) Unwrap() error { return e.Err }

var appVersionPattern = regexp.MustCompile(`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$`)

func normalizeAppVersion(value string) (string, error) {
	value = strings.TrimSuffix(strings.TrimSpace(value), "rc")
	if !appVersionPattern.MatchString(value) {
		return "", fmt.Errorf("invalid app version: %q", value)
	}
	for _, part := range strings.Split(value, ".") {
		if _, err := strconv.ParseUint(part, 10, 64); err != nil {
			return "", fmt.Errorf("invalid app version: %q", value)
		}
	}
	return value, nil
}

// Arguments have already passed normalizeAppVersion; compare numerically so
// e.g. 0.10.0 is newer than 0.9.0, regardless of rc and build timestamps.
func versionLess(left, right string) bool {
	a, b := strings.Split(left, "."), strings.Split(right, ".")
	for i := range a {
		x, _ := strconv.ParseUint(a[i], 10, 64)
		y, _ := strconv.ParseUint(b[i], 10, 64)
		if x != y {
			return x < y
		}
	}
	return false
}

func normalizeBuildInfo(build BuildInfo) (BuildInfo, string, error) {
	if build.Version == "" || build.Version == "dev" {
		build.Version = "dev"
		return build, MinimumAppVersion, nil
	}
	version, err := normalizeAppVersion(build.Version)
	if err != nil {
		return build, "", err
	}
	build.Version = version
	if versionLess(version, MinimumAppVersion) {
		return build, "", fmt.Errorf("build version %s predates its data format %s", version, MinimumAppVersion)
	}
	return build, version, nil
}

// This read must precede ALL schema, WAL, migration and metadata writes. A newer
// database must stay untouched when an older app rejects it. Absent/empty version
// metadata uses the historical baseline; valid legacy events remain loadable.
func checkDatabaseVersion(db *sql.DB, appVersion string) (string, error) {
	required := UnversionedMinimumAppVersion
	var exists int
	if err := db.QueryRow(`SELECT count(*) FROM sqlite_schema WHERE name='database_metadata'`).Scan(&exists); err != nil {
		return required, err
	}
	if exists != 0 {
		var stored sql.NullString
		err := db.QueryRow(`SELECT minimum_app_version FROM database_metadata WHERE id=1`).Scan(&stored)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return required, &CompatibilityError{MinimumVersion: required, Err: err}
		}
		if strings.TrimSpace(stored.String) != "" {
			version, err := normalizeAppVersion(stored.String)
			if err != nil {
				return required, &CompatibilityError{MinimumVersion: required, Err: err}
			}
			required = version
		}
	}
	if versionLess(appVersion, required) {
		return required, &CompatibilityError{MinimumVersion: required}
	}
	return required, nil
}

// CheckCompatibility only reads local version metadata: no migrations, build
// stamp, creation of missing databases, event replay or network/update request.
// Settings uses this for inactive databases as well as the active one.
func CheckCompatibility(dbPath string, build BuildInfo) error {
	_, version, err := normalizeBuildInfo(build)
	if err != nil {
		return err
	}
	absolute, err := filepath.Abs(dbPath)
	if err != nil {
		return err
	}
	path := filepath.ToSlash(absolute)
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	dsn := (&url.URL{Scheme: "file", Path: path, RawQuery: "mode=ro"}).String()
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return err
	}
	defer db.Close()
	_, err = checkDatabaseVersion(db, version)
	return err
}

// Publish the build stamp only after successful validation. The format floor is
// independent of patch releases and must never be lowered when reopening a file.
func writeDatabaseVersion(db *sql.DB, build BuildInfo, required string) error {
	if versionLess(required, MinimumAppVersion) {
		required = MinimumAppVersion
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`CREATE TABLE IF NOT EXISTS database_metadata (
		id INTEGER PRIMARY KEY CHECK (id=1),
		app_version TEXT NOT NULL,
		app_build_time TEXT NOT NULL,
		minimum_app_version TEXT NOT NULL
	)`); err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT INTO database_metadata(id,app_version,app_build_time,minimum_app_version)
		VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET app_version=excluded.app_version,
		app_build_time=excluded.app_build_time, minimum_app_version=excluded.minimum_app_version`,
		build.Version, build.BuildTime, required); err != nil {
		return err
	}
	return tx.Commit()
}
