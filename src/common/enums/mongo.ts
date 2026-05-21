/**
 * Numeric `code` values surfaced on `MongoServerError`. Extend as we start
 * branching on additional ones (see https://www.mongodb.com/docs/manual/reference/error-codes/).
 */
export enum MongoErrorCode {
	DuplicateKey = 11000,
}
