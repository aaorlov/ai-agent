import { Context } from "hono";
import { ZodError } from "zod";

export function handleError(c: Context, error: unknown) {
  // Handle Zod validation errors
  if (error instanceof ZodError) {
    return c.json(
      {
        error: "Validation error",
        details: error.errors,
      },
      400
    );
  }

  // Handle other errors
  if (error instanceof Error) {
    return c.json(
      {
        error: "Internal server error",
        message: error.message,
      },
      500
    );
  }

  // Handle unknown errors
  return c.json(
    {
      error: "Internal server error",
      message: "Unknown error occurred",
    },
    500
  );
}
