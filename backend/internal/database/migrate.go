package database

import (
	"fmt"
	"log/slog"

	"github.com/campusconnect/backend/migrations"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

// Migrate applies all pending Goose migrations. Migrations are embedded in the
// binary, so deployments do not need the source tree or a migration CLI.
func Migrate(pool *pgxpool.Pool) error {
	goose.SetBaseFS(migrations.FS)
	if err := goose.SetDialect("postgres"); err != nil {
		return fmt.Errorf("set goose dialect: %w", err)
	}

	db := stdlib.OpenDBFromPool(pool)
	defer db.Close()

	if err := goose.Up(db, "."); err != nil {
		return fmt.Errorf("apply migrations: %w", err)
	}
	slog.Info("database migrations applied")
	return nil
}

func MigrationStatus(pool *pgxpool.Pool) error {
	db := stdlib.OpenDBFromPool(pool)
	defer db.Close()
	return goose.Status(db, ".")
}
