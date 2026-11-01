package repositories

import (
	"errors"
	"strings"

	"github.com/campusconnect/backend/internal/apperr"
	"github.com/jackc/pgx/v5/pgconn"
)

// MapPGError converts database integrity failures into safe application errors.
// Unrecognized errors are returned unchanged so services can wrap them.
func MapPGError(err error, conflictMessage string) error {
	if err == nil {
		return nil
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "23505": // unique_violation
			return apperr.Conflict(conflictMessage)
		case "23503": // foreign_key_violation
			return apperr.Conflict("This record is still referenced and cannot be changed.")
		case "23514": // check_violation
			return apperr.Unprocessable("The operation violates a database rule.")
		case "22P02": // invalid_text_representation
			return apperr.BadRequest("One of the provided values has an invalid format.")
		}
	}
	// Trigger-raised exceptions also surface as PgError but with message text that
	// can be useful to the service layer.
	if strings.Contains(err.Error(), "at capacity") {
		return apperr.Conflict("This event is full.")
	}
	return err
}
